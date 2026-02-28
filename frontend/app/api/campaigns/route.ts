import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Allow up to 60s for on-chain fetching

// ─── Helpers ────────────────────────────────────────────────────────────────

async function fetchJson(url: string, timeout = 15000) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(tid);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch (e) {
    clearTimeout(tid);
    throw e;
  }
}

async function getAllPages(baseUrl: string, maxPages = 20) {
  const all: any[] = [];
  let url: string | null = baseUrl;
  let pages = 0;
  while (url && pages < maxPages) {
    const d = await fetchJson(url);
    all.push(...(d.items ?? []));
    const np = d.next_page_params;
    url = np ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${new URLSearchParams(np)}` : null;
    pages++;
  }
  return all;
}

async function getEthPrice(): Promise<number> {
  try {
    const d = await fetchJson('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
    return d.ethereum?.usd ?? 2000;
  } catch {
    return 2000;
  }
}

// ─── Rally API ──────────────────────────────────────────────────────────────

async function fetchRallyCampaigns() {
  const all: any[] = [];
  for (let page = 1; page <= 5; page++) {
    try {
      const d = await fetchJson(`https://app.rally.fun/api/campaigns?page=${page}&limit=50`);
      all.push(...(d.campaigns ?? []));
      if (!d.pagination?.hasNext) break;
    } catch { break; }
  }
  return all;
}

async function fetchSubmissions(ic: string) {
  try {
    const raw = await fetchJson(`https://app.rally.fun/api/submissions?campaignAddress=${ic}&limit=10000`, 12000);
    return Array.isArray(raw) ? raw : Object.values(raw);
  } catch { return []; }
}

// ─── On-Chain Discovery ─────────────────────────────────────────────────────

const BLOCKSCOUT_BASE = 'https://base.blockscout.com/api/v2';
const FACTORIES = [
  '0xe62DC9DEA493d3d2072d154a877A0715C1CAe03D',
  '0x6187CB90B868f9eD34cc9fd4B0B78e2e9cAb4248',
];
const CAMPAIGN_TOPICS = [
  '0xbb6e1a036316f8a54a4010c72f0adc5e7b714b15cff9045f280f3080b5fb5a60',
  '0x6056366dba45431fd6a8854ad9f2594942b02c4f2c3f6fbc329b3079b027b8b4',
];

interface OnChainCampaign {
  address: string;
  ic: string | null;
}

async function discoverOnChainCampaigns(): Promise<OnChainCampaign[]> {
  const campaignMap = new Map<string, OnChainCampaign>();
  
  for (const factory of FACTORIES) {
    try {
      const logs = await getAllPages(`${BLOCKSCOUT_BASE}/addresses/${factory}/logs`, 5);
      for (const log of logs) {
        if (CAMPAIGN_TOPICS.includes(log.topics?.[0])) {
          const addr = ('0x' + (log.topics[1] ?? '').slice(-40)).toLowerCase();
          if (addr && addr !== '0x' + '0'.repeat(40)) {
            // Extract IC from data field (third 32-byte word)
            let ic: string | null = null;
            if (log.data && log.data.length >= 194) {
              const icRaw = log.data.slice(2 + 128, 2 + 192);
              if (icRaw && icRaw !== '0'.repeat(64)) {
                ic = ('0x' + icRaw.slice(-40)).toLowerCase();
              }
            }
            if (!campaignMap.has(addr) || (ic && !campaignMap.get(addr)?.ic)) {
              campaignMap.set(addr, { address: addr, ic });
            }
          }
        }
      }
    } catch (e) {
      console.error(`Factory ${factory} error:`, e);
    }
  }
  
  return [...campaignMap.values()];
}

interface OnChainStats {
  participants: number;
  successTxs: number;
  failedTxs: number;
  successEth: number;
  failedEth: number;
  firstTs: number | null;
}

async function getCampaignOnChainStats(campAddr: string): Promise<OnChainStats> {
  try {
    const txs = await getAllPages(`${BLOCKSCOUT_BASE}/addresses/${campAddr}/transactions`, 20);
    const participants = new Set<string>();
    let successWei = 0n, failedWei = 0n, successTxs = 0, failedTxs = 0;
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
  } catch {
    return { participants: 0, successTxs: 0, failedTxs: 0, successEth: 0, failedEth: 0, firstTs: null };
  }
}

// ─── Main API Handler ───────────────────────────────────────────────────────

function formatPrize(reward: any, symbol: string | undefined): string | null {
  if (!reward) return null;
  const n = Number(reward.totalAmount);
  const sym = symbol ?? '';
  if (n >= 1e9) return `${(n / 1e9).toFixed(0)}B ${sym}`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)}M ${sym}`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K ${sym}`;
  return `${n} ${sym}`;
}

export async function GET() {
  const startTime = Date.now();
  
  try {
    // Fetch all data sources in parallel
    const [ethPrice, rallyCampaigns, onChainCampaigns] = await Promise.all([
      getEthPrice(),
      fetchRallyCampaigns(),
      discoverOnChainCampaigns(),
    ]);

    const now = new Date();
    const nowMs = now.getTime();

    // Build IC → Rally campaign lookup
    const rallyByIC: Record<string, any> = {};
    for (const c of rallyCampaigns) {
      const ic = (c.intelligentContractAddress ?? '').toLowerCase();
      if (ic) rallyByIC[ic] = c;
    }

    // Build IC → on-chain campaign lookup
    const onChainByIC: Record<string, OnChainCampaign> = {};
    for (const c of onChainCampaigns) {
      if (c.ic) onChainByIC[c.ic] = c;
    }

    // Get active Rally campaigns
    const activeCampaigns = rallyCampaigns.filter((c: any) => new Date(c.endDate) > now);

    // Process each active campaign
    const campaigns = await Promise.all(
      activeCampaigns.slice(0, 15).map(async (camp: any) => {
        const ic = (camp.intelligentContractAddress ?? '').toLowerCase();
        const onChain = ic ? onChainByIC[ic] : null;

        // Fetch Rally submissions
        let users = 0, submissions = 0, approved = 0, rejected = 0, avgScore = 0;
        if (ic) {
          const subs = await fetchSubmissions(ic);
          submissions = subs.length;
          rejected = subs.filter((s: any) => s.disqualifiedAt || s.hiddenAt || s.invalidatedAt).length;
          approved = submissions - rejected;
          users = new Set(subs.map((s: any) => s.userXId)).size;
          const scores = subs.filter((s: any) => s.atemporalPoints).map((s: any) => {
            try { return Number(BigInt(s.atemporalPoints)) / 1e18; } catch { return 0; }
          });
          avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
        }

        // Fetch on-chain stats if fee campaign exists
        let revenueUsd: number | null = null;
        let participants: number | null = null;
        let failedTxs = 0;
        let failedUsd = 0;
        let ghostWallets = 0;

        if (onChain) {
          const stats = await getCampaignOnChainStats(onChain.address);
          revenueUsd = stats.successEth * ethPrice;
          participants = stats.participants;
          failedTxs = stats.failedTxs;
          failedUsd = stats.failedEth * ethPrice;
          ghostWallets = Math.max(0, stats.participants - users);
        }

        const remainDays = Math.max(0, (new Date(camp.endDate).getTime() - nowMs) / 86400000);

        return {
          title: camp.title,
          address: ic ?? camp.campaignContractAddress ?? '',
          creator: camp.displayCreator?.xUsername ?? null,
          prize: formatPrize(camp.campaignRewards?.[0], camp.token?.symbol),
          users,
          submissions,
          approved,
          rejected,
          avgScore,
          remainDays: Math.ceil(remainDays),
          revenueUsd,
          participants,
          failedTxs,
          failedUsd,
          ghostWallets,
        };
      })
    );

    // Sort by revenue (fee campaigns first), then by users
    campaigns.sort((a, b) => (b.revenueUsd ?? -1) - (a.revenueUsd ?? -1) || b.users - a.users);

    // Calculate totals from on-chain campaigns
    let totalRevenue = 0;
    let totalParticipants = 0;
    let totalFailedTxs = 0;
    let totalFailedUsd = 0;
    let totalGhostWallets = 0;
    let totalRallyUsers = 0;
    let earliestTs: number | null = null;

    // Fetch stats for ALL on-chain campaigns (not just active in Rally)
    const allOnChainStats = await Promise.all(
      onChainCampaigns.map(async (camp) => {
        const stats = await getCampaignOnChainStats(camp.address);
        const rallyMeta = camp.ic ? rallyByIC[camp.ic] : null;
        let rallyUsers = 0;
        if (camp.ic && rallyMeta) {
          const subs = await fetchSubmissions(camp.ic);
          rallyUsers = new Set(subs.map((s: any) => s.userXId)).size;
        }
        return { ...stats, rallyUsers };
      })
    );

    for (const stats of allOnChainStats) {
      totalRevenue += stats.successEth * ethPrice;
      totalParticipants += stats.participants;
      totalFailedTxs += stats.failedTxs;
      totalFailedUsd += stats.failedEth * ethPrice;
      totalRallyUsers += stats.rallyUsers;
      const ghost = stats.participants - stats.rallyUsers;
      if (ghost > 0) totalGhostWallets += ghost;
      if (stats.firstTs && (!earliestTs || stats.firstTs < earliestTs)) earliestTs = stats.firstTs;
    }

    // Calculate ARR
    let arr: number | null = null;
    let dailyRate: number | null = null;
    let ageDays: number | null = null;
    if (earliestTs && totalRevenue > 0) {
      ageDays = (nowMs - earliestTs) / 86400000;
      if (ageDays >= 0.5) {
        dailyRate = totalRevenue / ageDays;
        arr = dailyRate * 365;
      }
    }

    const totalUsers = campaigns.reduce((sum, c) => sum + c.users, 0);
    const totalSubmissions = campaigns.reduce((sum, c) => sum + c.submissions, 0);

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      fetchTimeMs: Date.now() - startTime,
      ethPrice,
      campaigns,
      stats: {
        totalCampaigns: rallyCampaigns.length,
        activeCampaigns: activeCampaigns.length,
        onChainCampaigns: onChainCampaigns.length,
        totalUsers,
        totalSubmissions,
        totalRevenue,
        totalParticipants,
        totalRallyUsers,
        totalFailedTxs,
        totalFailedUsd,
        ghostWallets: totalGhostWallets,
        arr,
        dailyRate,
        ageDays,
      },
    });
  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
