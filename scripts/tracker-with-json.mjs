#!/usr/bin/env node
/**
 * Rally Campaign Tracker — outputs JSON for frontend + detects new campaigns
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(__dir, 'campaign-state.json');
const JSON_OUTPUT = join(__dir, '..', 'frontend', 'public', 'data.json');

// Two CampaignCreated event signatures
const CAMPAIGN_TOPICS = [
  '0xbb6e1a036316f8a54a4010c72f0adc5e7b714b15cff9045f280f3080b5fb5a60',
  '0x6056366dba45431fd6a8854ad9f2594942b02c4f2c3f6fbc329b3079b027b8b4',
];

const CHAINS = {
  base: {
    name: 'Base',
    apiBase: 'https://base.blockscout.com/api/v2',
    factories: [
      '0xe62DC9DEA493d3d2072d154a877A0715C1CAe03D',
      '0x6187CB90B868f9eD34cc9fd4B0B78e2e9cAb4248',
    ],
    explorer: 'https://basescan.org',
  },
};

async function get(url, timeout = 20000) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getAllPages(baseUrl, maxPages = 5) {
  let all = [], url = baseUrl, pages = 0;
  while (url && pages < maxPages) {
    const d = await get(url);
    all = all.concat(d.items ?? []);
    const np = d.next_page_params;
    url = np ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${new URLSearchParams(np)}` : null;
    pages++;
  }
  return all;
}

function loadState() {
  return existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {};
}

function saveState(s) {
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

async function getEthPrice() {
  try {
    const d = await get('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
    return d.ethereum?.usd ?? 2000;
  } catch { return 2000; }
}

async function fetchAllRallyCampaigns() {
  const all = [];
  for (let page = 1; page <= 5; page++) {
    try {
      const d = await get(`https://app.rally.fun/api/campaigns?page=${page}&limit=50`);
      all.push(...(d.campaigns ?? []));
      if (!d.pagination?.hasNext) break;
    } catch { break; }
  }
  return all;
}

async function fetchRallySubmissions(ic) {
  try {
    const raw = await get(`https://app.rally.fun/api/submissions?campaignAddress=${ic}&limit=10000`);
    return Array.isArray(raw) ? raw : Object.values(raw);
  } catch { return []; }
}

async function discoverCampaigns(chain) {
  const campaigns = [];
  for (const fac of chain.factories) {
    try {
      const logs = await getAllPages(`${chain.apiBase}/addresses/${fac}/logs`, 3);
      for (const log of logs) {
        if (CAMPAIGN_TOPICS.includes(log.topics?.[0])) {
          const addr = ('0x' + (log.topics[1] ?? '').slice(-40)).toLowerCase();
          if (addr && addr !== '0x' + '0'.repeat(40)) campaigns.push({ address: addr });
        }
      }
    } catch (e) {
      console.error(`Error fetching ${fac}:`, e.message);
    }
  }
  return [...new Map(campaigns.map(c => [c.address, c])).values()];
}

async function getIntelligentContract(apiBase, campAddr) {
  try {
    const logs = await getAllPages(`${apiBase}/addresses/${campAddr}/logs`, 2);
    for (const log of logs) {
      if (log.decoded?.method_call?.includes('AuthorizedSourceAdded')) {
        const src = log.decoded.parameters?.find(p => p.name === 'sourceContract');
        if (src) return (src.value ?? '').toLowerCase();
      }
    }
  } catch {}
  return null;
}

async function getCampaignOnChainStats(apiBase, campAddr) {
  try {
    const txs = await getAllPages(`${apiBase}/addresses/${campAddr}/transactions`, 3);
    const participants = new Set();
    let successWei = 0n, failedWei = 0n, successTxs = 0, failedTxs = 0, firstTs = null;

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

async function main() {
  console.log('🚀 Starting Rally tracker...');
  const state = loadState();
  const prevCampaignCount = Object.keys(state.base?.campaigns ?? {}).length;
  
  const ethPrice = await getEthPrice();
  const allRallyCampaigns = await fetchAllRallyCampaigns();
  
  const rallyByIC = {};
  for (const c of allRallyCampaigns) {
    const ic = (c.intelligentContractAddress ?? '').toLowerCase();
    if (ic) rallyByIC[ic] = c;
  }

  const chain = CHAINS.base;
  const onChainCampaigns = await discoverCampaigns(chain);
  console.log(`📊 Found ${onChainCampaigns.length} on-chain campaigns`);

  const feeCampaigns = [];
  const newChainState = { campaigns: {} };
  let totalRevenue = 0, totalParticipants = 0, totalRallyUsers = 0;
  let totalFailedTxs = 0, totalFailedUsd = 0, ghostWallets = 0;
  let earliestTs = null;
  const DAY_MS = 86400000;
  const nowMs = Date.now();

  for (const camp of onChainCampaigns) {
    const ic = await getIntelligentContract(chain.apiBase, camp.address);
    const meta = (ic && rallyByIC[ic]) ?? null;
    const oc = await getCampaignOnChainStats(chain.apiBase, camp.address);

    let rallyUsers = 0, avgScore = 0, approved = 0, rejected = 0;
    if (ic && meta) {
      const subs = await fetchRallySubmissions(ic);
      rejected = subs.filter(s => s.disqualifiedAt || s.hiddenAt || s.invalidatedAt).length;
      approved = subs.length - rejected;
      rallyUsers = new Set(subs.map(s => s.userXId)).size;
      const scores = subs.filter(s => s.atemporalPoints).map(s => {
        try { return Number(BigInt(s.atemporalPoints)) / 1e18; } catch { return 0; }
      });
      avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    }

    const successUsd = oc.successEth * ethPrice;
    const failedUsd = oc.failedEth * ethPrice;
    const startDate = meta?.startDate ? new Date(meta.startDate) : null;
    const endDate = meta?.endDate ? new Date(meta.endDate) : null;
    const remainDays = endDate ? Math.max(0, (endDate.getTime() - nowMs) / DAY_MS) : null;
    const isEnded = endDate && endDate <= new Date();
    const periods = meta?.campaignDurationPeriods ?? 1;
    const periodDays = meta?.periodLengthDays ?? 0;
    const totalDays = periods * periodDays;

    if (isEnded && oc.participants === 0) continue;

    const reward = meta?.campaignRewards?.[0];
    const prize = reward ? `${Number(reward.totalAmount).toLocaleString()} ${meta?.token?.symbol ?? ''}` : null;

    // Calculate projections
    const ageDays = oc.firstTs ? (nowMs - oc.firstTs) / DAY_MS : null;
    const dailyRate = (ageDays && ageDays > 0.1 && successUsd > 0) ? successUsd / ageDays : null;
    const projectedRevenue = (dailyRate && totalDays > 0) ? dailyRate * totalDays : null;
    const approvalRate = (approved > 0 && oc.successTxs > 0) ? approved / oc.successTxs : null;

    // Deltas vs last run
    const prev = state.base?.campaigns?.[camp.address] ?? {};
    const newParticipants = Math.max(0, oc.participants - (prev.participants ?? 0));
    const prevSuccessEth = prev.successEth ?? 0;
    const newRevenueEth = Math.max(0, oc.successEth - prevSuccessEth);
    const newRevenueUsd = newRevenueEth * ethPrice;

    // Accumulate stats
    totalRevenue += successUsd;
    totalParticipants += oc.participants;
    totalRallyUsers += rallyUsers;
    totalFailedTxs += oc.failedTxs;
    totalFailedUsd += failedUsd;
    const ghost = oc.participants - rallyUsers;
    if (ghost > 0) ghostWallets += ghost;
    if (oc.firstTs && (!earliestTs || oc.firstTs < earliestTs)) earliestTs = oc.firstTs;

    newChainState.campaigns[camp.address] = { participants: oc.participants, successEth: oc.successEth };

    feeCampaigns.push({
      address: camp.address,
      ic: ic ?? null,
      title: meta?.title ?? `${camp.address.slice(0,6)}…${camp.address.slice(-4)}`,
      creator: meta?.displayCreator?.xUsername ?? null,
      participants: oc.participants,
      rallyUsers,
      revenueEth: oc.successEth,
      revenueUsd: successUsd,
      failedTxs: oc.failedTxs,
      failedUsd,
      avgScore,
      approved,
      rejected,
      approvalRate,
      prize,
      remainDays: remainDays != null ? Math.ceil(remainDays) : null,
      isEnded,
      ghostWallets: ghost > 0 ? ghost : 0,
      // Projections
      dailyRate,
      projectedRevenue,
      // Deltas
      newParticipants,
      newRevenueUsd,
    });
  }

  // Sort by revenue
  feeCampaigns.sort((a, b) => (b.revenueUsd ?? 0) - (a.revenueUsd ?? 0));

  // Free campaigns (not on-chain)
  const handledICs = new Set(feeCampaigns.map(c => c.address));
  const now = new Date();
  const freeCampaigns = allRallyCampaigns
    .filter(c => {
      const ic = (c.intelligentContractAddress ?? '').toLowerCase();
      return !handledICs.has(ic) && new Date(c.endDate) > now;
    })
    .slice(0, 10)
    .map(c => ({
      title: c.title,
      creator: c.displayCreator?.xUsername ?? null,
      remainDays: Math.ceil((new Date(c.endDate).getTime() - now.getTime()) / 86400000),
    }));

  // Save state
  state.base = newChainState;
  state.lastRun = new Date().toISOString();
  saveState(state);

  // Check for new campaigns
  const currentCampaignCount = Object.keys(newChainState.campaigns).length;
  const newCampaigns = currentCampaignCount - prevCampaignCount;

  // Calculate ARR
  let arr = null, dailyRateGlobal = null;
  if (earliestTs && totalRevenue > 0) {
    const ageDays = (nowMs - earliestTs) / DAY_MS;
    if (ageDays >= 0.5) {
      dailyRateGlobal = totalRevenue / ageDays;
      arr = dailyRateGlobal * 365;
    }
  }

  // Output JSON for frontend
  const output = {
    timestamp: new Date().toISOString(),
    ethPrice,
    feeCampaigns,
    freeCampaigns,
    stats: {
      totalRevenue,
      totalParticipants,
      totalRallyUsers,
      totalFailedTxs,
      totalFailedUsd,
      ghostWallets,
      onChainCampaigns: onChainCampaigns.length,
      rallyCampaigns: allRallyCampaigns.length,
      // ARR metrics
      arr,
      dailyRate: dailyRateGlobal,
      earliestTs,
      ageDays: earliestTs ? (nowMs - earliestTs) / DAY_MS : null,
    },
  };

  writeFileSync(JSON_OUTPUT, JSON.stringify(output, null, 2));
  console.log(`✅ Saved to ${JSON_OUTPUT}`);

  // Alert if new campaigns
  if (newCampaigns > 0) {
    console.log(`\n🆕 NEW CAMPAIGNS DETECTED: ${newCampaigns}`);
    console.log('---NEW_CAMPAIGNS---');
    console.log(JSON.stringify({ count: newCampaigns, total: currentCampaignCount }));
    console.log('---END---');
  }

  console.log(`\n📊 Summary: ${feeCampaigns.length} fee campaigns | $${totalRevenue.toFixed(2)} revenue | ${totalParticipants} wallets`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
