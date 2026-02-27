import { NextResponse } from 'next/server';

const CAMPAIGN_CREATED_TOPIC = '0xbb6e1a036316f8a54a4010c72f0adc5e7b714b15cff9045f280f3080b5fb5a60';

const CHAINS = {
  base: {
    name: 'Base',
    apiBase: 'https://base.blockscout.com/api/v2',
    factories: [
      '0xe62DC9DEA493d3d2072d154a877A0715C1CAe03D',
      '0x6187CB90B868f9eD34cc9fd4B0B78e2e9cAb4248',
    ],
    explorer: 'https://basescan.org',
    chainId: 8453,
  },
  zksync: {
    name: 'zkSync Era',
    apiBase: 'https://zksync.blockscout.com/api/v2',
    factories: [
      '0x608a65b4503BFe3B32Ea356a47A86937345862cc',
      '0x3F71378bA3B8134cfAE1De84F0b3E51fDB4fECa2',
    ],
    explorer: 'https://explorer.zksync.io',
    chainId: 324,
  },
};

async function fetchJson(url: string) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getAllPages(baseUrl: string) {
  let all: any[] = [], url: string | null = baseUrl;
  while (url) {
    const d = await fetchJson(url);
    all = all.concat(d.items ?? []);
    const np = d.next_page_params;
    url = np ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${new URLSearchParams(np)}` : null;
    if (all.length > 500) break; // Safety limit
  }
  return all;
}

async function getEthPrice() {
  try {
    const d = await fetchJson('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
    return d.ethereum?.usd ?? 2000;
  } catch { return 2000; }
}

async function fetchAllRallyCampaigns() {
  const all: any[] = [];
  let page = 1;
  while (true) {
    const d = await fetchJson(`https://app.rally.fun/api/campaigns?page=${page}&limit=50`);
    all.push(...(d.campaigns ?? []));
    if (!d.pagination?.hasNext) break;
    if (++page > 10) break;
  }
  return all;
}

async function fetchRallySubmissions(intelligentContractAddress: string) {
  const raw = await fetchJson(`https://app.rally.fun/api/submissions?campaignAddress=${intelligentContractAddress}&limit=10000`);
  return Array.isArray(raw) ? raw : Object.values(raw);
}

async function discoverCampaigns(chain: typeof CHAINS.base) {
  const campaigns: { address: string; factory: string }[] = [];
  for (const fac of chain.factories) {
    let logs;
    try { logs = await getAllPages(`${chain.apiBase}/addresses/${fac}/logs`); }
    catch { continue; }
    for (const log of logs) {
      if (log.topics?.[0] === CAMPAIGN_CREATED_TOPIC) {
        const addr = ('0x' + (log.topics[1] ?? '').slice(-40)).toLowerCase();
        if (addr !== '0x' + '0'.repeat(40)) campaigns.push({ address: addr, factory: fac });
      }
    }
  }
  return [...new Map(campaigns.map(c => [c.address, c])).values()];
}

async function getIntelligentContract(apiBase: string, campAddr: string) {
  try {
    const logs = await getAllPages(`${apiBase}/addresses/${campAddr}/logs`);
    for (const log of logs) {
      if (log.decoded?.method_call?.includes('AuthorizedSourceAdded')) {
        const src = log.decoded.parameters?.find((p: any) => p.name === 'sourceContract');
        if (src) return (src.value ?? '').toLowerCase();
      }
    }
  } catch {}
  return null;
}

async function getCampaignOnChainStats(apiBase: string, campAddr: string) {
  const txs = await getAllPages(`${apiBase}/addresses/${campAddr}/transactions`);

  const participants = new Set<string>();
  let successWei = 0n, failedWei = 0n;
  let successTxs = 0, failedTxs = 0;
  let firstTs: number | null = null;

  for (const tx of txs) {
    const toAddr = (tx.to?.hash ?? '').toLowerCase();
    const from = (tx.from?.hash ?? '').toLowerCase();
    const value = BigInt(tx.value ?? '0');
    if (value === 0n || toAddr !== campAddr.toLowerCase()) continue;

    if (tx.status === 'error') {
      failedTxs++;
      failedWei += value;
    } else {
      participants.add(from);
      successWei += value;
      successTxs++;
      const ts = tx.timestamp ? new Date(tx.timestamp).getTime() : null;
      if (ts && (!firstTs || ts < firstTs)) firstTs = ts;
    }
  }

  return {
    participants: participants.size,
    successTxs,
    failedTxs,
    successEth: Number(successWei) / 1e18,
    failedEth: Number(failedWei) / 1e18,
    firstTs,
  };
}

export async function GET() {
  try {
    const ethPrice = await getEthPrice();
    const allRallyCampaigns = await fetchAllRallyCampaigns();
    
    const rallyByIC: Record<string, any> = {};
    for (const c of allRallyCampaigns) {
      const ic = (c.intelligentContractAddress ?? '').toLowerCase();
      if (ic) rallyByIC[ic] = c;
    }

    const feeCampaigns: any[] = [];
    const freeCampaigns: any[] = [];
    const handledICs = new Set<string>();
    
    let grandStats = {
      totalRevenue: 0,
      totalParticipants: 0,
      totalRallyUsers: 0,
      totalFailedTxs: 0,
      totalFailedUsd: 0,
      ghostWallets: 0,
      earliestTs: null as number | null,
    };

    // Process fee campaigns (on-chain)
    for (const [chainKey, chain] of Object.entries(CHAINS)) {
      let campaigns;
      try { campaigns = await discoverCampaigns(chain); }
      catch { continue; }

      for (const camp of campaigns) {
        const ic = await getIntelligentContract(chain.apiBase, camp.address);
        const meta = (ic && rallyByIC[ic]) ?? null;
        if (ic) handledICs.add(ic.toLowerCase());

        let oc;
        try { oc = await getCampaignOnChainStats(chain.apiBase, camp.address); }
        catch { continue; }

        let rallySubs: any[] = [], rallyApproved = 0, rallyRejected = 0, rallyUsers = 0, avgScore = 0;
        if (ic && rallyByIC[ic]) {
          try {
            rallySubs = await fetchRallySubmissions(ic);
            rallyRejected = rallySubs.filter((s: any) => s.disqualifiedAt || s.hiddenAt || s.invalidatedAt).length;
            rallyApproved = rallySubs.length - rallyRejected;
            rallyUsers = new Set(rallySubs.map((s: any) => s.userXId)).size;
            const scores = rallySubs.filter((s: any) => s.atemporalPoints).map((s: any) => Number(BigInt(s.atemporalPoints)) / 1e18);
            avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
          } catch {}
        }

        if (oc.participants === 0 && rallyUsers === 0) continue;

        const successUsd = oc.successEth * ethPrice;
        const failedUsd = oc.failedEth * ethPrice;
        const reward = meta?.campaignRewards?.[0];
        const endDate = meta?.endDate ? new Date(meta.endDate) : null;
        const remainDays = endDate ? Math.max(0, (endDate.getTime() - Date.now()) / 86400000) : null;
        
        const ageDays = oc.firstTs ? (Date.now() - oc.firstTs) / 86400000 : null;
        const dailyRate = ageDays && ageDays > 0.1 ? successUsd / ageDays : null;
        const projectedRevenue = dailyRate && remainDays ? dailyRate * remainDays + successUsd : null;

        const issues: string[] = [];
        if (oc.failedTxs > 0) issues.push(`${oc.failedTxs} failed txs ($${failedUsd.toFixed(2)})`);
        const ghostCount = oc.participants - rallyUsers;
        if (ghostCount > 3) issues.push(`${ghostCount} ghost wallets`);
        if (avgScore > 0 && avgScore < 1.0) issues.push(`Low score: ${avgScore.toFixed(1)}/5`);

        grandStats.totalRevenue += successUsd;
        grandStats.totalParticipants += oc.participants;
        grandStats.totalRallyUsers += rallyUsers;
        grandStats.totalFailedTxs += oc.failedTxs;
        grandStats.totalFailedUsd += failedUsd;
        if (ghostCount > 0) grandStats.ghostWallets += ghostCount;
        if (oc.firstTs && (!grandStats.earliestTs || oc.firstTs < grandStats.earliestTs)) {
          grandStats.earliestTs = oc.firstTs;
        }

        feeCampaigns.push({
          address: camp.address,
          chain: chainKey,
          chainName: chain.name,
          explorer: `${chain.explorer}/address/${camp.address}`,
          title: meta?.title ?? `${camp.address.slice(0,6)}…${camp.address.slice(-4)}`,
          creator: meta?.displayCreator?.xUsername ?? null,
          participants: oc.participants,
          rallyUsers,
          successTxs: oc.successTxs,
          failedTxs: oc.failedTxs,
          revenueEth: oc.successEth,
          revenueUsd: successUsd,
          failedUsd,
          avgScore,
          approved: rallyApproved,
          rejected: rallyRejected,
          prize: reward ? `${Number(reward.totalAmount).toLocaleString()} ${meta?.token?.symbol ?? ''}` : null,
          remainDays,
          projectedRevenue,
          dailyRate,
          issues,
          startDate: meta?.startDate,
          endDate: meta?.endDate,
        });
      }
    }

    // Process free campaigns (Rally API only)
    const now = new Date();
    for (const camp of allRallyCampaigns) {
      const ic = (camp.intelligentContractAddress ?? '').toLowerCase();
      const ended = new Date(camp.endDate) <= now;
      if (ended || handledICs.has(ic)) continue;

      let subs: any[] = [], approved = 0, rejected = 0, users = 0, avgScore = 0;
      try {
        subs = Object.values(await fetchRallySubmissions(ic));
        rejected = subs.filter((s: any) => s.disqualifiedAt || s.hiddenAt || s.invalidatedAt).length;
        approved = subs.length - rejected;
        users = new Set(subs.map((s: any) => s.userXId)).size;
        const scores = subs.filter((s: any) => s.atemporalPoints).map((s: any) => Number(BigInt(s.atemporalPoints)) / 1e18);
        avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
      } catch {}

      if (users === 0 && subs.length === 0) continue;

      const reward = camp.campaignRewards?.[0];
      const remainDays = Math.max(0, (new Date(camp.endDate).getTime() - Date.now()) / 86400000);

      freeCampaigns.push({
        address: ic,
        title: camp.title,
        creator: camp.displayCreator?.xUsername ?? null,
        users,
        submissions: subs.length,
        approved,
        rejected,
        avgScore,
        prize: reward ? `${Number(reward.totalAmount).toLocaleString()} ${camp.token?.symbol ?? ''}` : null,
        remainDays,
        startDate: camp.startDate,
        endDate: camp.endDate,
      });
    }

    // Calculate ARR
    let arr = null;
    if (grandStats.earliestTs && grandStats.totalRevenue > 0) {
      const ageDays = (Date.now() - grandStats.earliestTs) / 86400000;
      if (ageDays >= 0.5) {
        const dailyRate = grandStats.totalRevenue / ageDays;
        arr = dailyRate * 365;
      }
    }

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      ethPrice,
      feeCampaigns,
      freeCampaigns,
      stats: {
        ...grandStats,
        arr,
        dailyRate: arr ? arr / 365 : null,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
