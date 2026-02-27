#!/usr/bin/env node
/**
 * Rally Campaign Tracker v2 — dual-source: Rally API + on-chain (Blockscout)
 *
 * Data sources:
 *   Rally API  → submissions (approved/rejected), unique users, avg score, prize, periods
 *   On-chain   → actual ETH paid, successful vs failed txs, participant wallet count
 *
 * Key distinction:
 *   Rally "approved" = passed AI content scoring
 *   On-chain "success" = tx not reverted (user paid)
 *   A tx can succeed on-chain but be rejected by AI scoring — fee is kept either way
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(__dir, 'campaign-state.json');

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

// ─── helpers ────────────────────────────────────────────────────────────────

async function get(url) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getAllPages(baseUrl) {
  let all = [], url = baseUrl;
  while (url) {
    const d = await get(url);
    all = all.concat(d.items ?? []);
    const np = d.next_page_params;
    url = np ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${new URLSearchParams(np)}` : null;
  }
  return all;
}

function loadState() {
  return existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {};
}

function saveState(s) {
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

// Ring buffer of {ts, totalFeesUsd} — max 8 days
function addSnapshot(state, totalFeesUsd) {
  if (!state._snapshots) state._snapshots = [];
  const ts = Date.now();
  state._snapshots.push({ ts, totalFeesUsd });
  const cutoff = ts - 8 * 24 * 3600 * 1000;
  state._snapshots = state._snapshots.filter(s => s.ts >= cutoff);
}

function snapshotDelta(state, msAgo) {
  const snapshots = state._snapshots ?? [];
  if (snapshots.length < 2) return null;
  const target = Date.now() - msAgo;
  let best = null, bestDiff = Infinity;
  for (const s of snapshots) {
    const diff = Math.abs(s.ts - target);
    if (diff < bestDiff) { bestDiff = diff; best = s; }
  }
  if (!best || bestDiff > msAgo * 0.2) return null;
  return best;
}

async function getEthPrice() {
  try {
    const d = await get('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
    return d.ethereum?.usd ?? 2000;
  } catch { return 2000; }
}

// ─── Rally API ───────────────────────────────────────────────────────────────

async function fetchAllRallyCampaigns() {
  const all = [];
  let page = 1;
  while (true) {
    const d = await get(`https://app.rally.fun/api/campaigns?page=${page}&limit=50`);
    all.push(...(d.campaigns ?? []));
    if (!d.pagination?.hasNext) break;
    if (++page > 20) break;
  }
  return all;
}

async function fetchRallySubmissions(intelligentContractAddress) {
  const raw = await get(`https://app.rally.fun/api/submissions?campaignAddress=${intelligentContractAddress}&limit=10000`);
  return Array.isArray(raw) ? raw : Object.values(raw);
}

// ─── On-chain discovery ───────────────────────────────────────────────────────

async function discoverCampaigns(chain) {
  const campaigns = [];
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

async function getIntelligentContract(apiBase, campAddr) {
  try {
    const logs = await getAllPages(`${apiBase}/addresses/${campAddr}/logs`);
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
  const txs = await getAllPages(`${apiBase}/addresses/${campAddr}/transactions`);

  const participants = new Set();
  let successWei = 0n, failedWei = 0n;
  let successTxs = 0, failedTxs = 0;
  let firstTs = null;

  for (const tx of txs) {
    const toAddr = (tx.to?.hash ?? '').toLowerCase();
    const from   = (tx.from?.hash ?? '').toLowerCase();
    const value  = BigInt(tx.value ?? '0');
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
    successWei: successWei.toString(),
    failedWei:  failedWei.toString(),
    successEth: Number(successWei) / 1e18,
    failedEth:  Number(failedWei)  / 1e18,
    firstTs,
  };
}

// ─── formatting ──────────────────────────────────────────────────────────────

const fmt = (n) => n == null ? '-' :
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` :
  n >= 1_000     ? `$${Math.round(n).toLocaleString()}` :
                   `$${n.toFixed(2)}`;

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  const state   = loadState();
  const ethPrice = await getEthPrice();
  const now     = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const nowMs   = Date.now();
  const DAY_MS  = 86_400_000;

  // Fetch all Rally campaigns — filter to those with on-chain fee distribution
  const allRallyCampaigns = await fetchAllRallyCampaigns();
  // Only campaigns on Base or zkSync (have on-chain fee component)
  const rallyByIC = {};
  for (const c of allRallyCampaigns) {
    const ic = (c.intelligentContractAddress ?? '').toLowerCase();
    if (ic) rallyByIC[ic] = c;
  }

  const lines = [`⚡ *Rally* — ${now} | ETH $${ethPrice.toLocaleString()}\n`];

  let grandSuccessUsd = 0, grandFailedUsd = 0;
  let grandParticipants = 0, grandRallyUsers = 0;
  let grandSuccessTxs = 0, grandFailedTxs = 0;
  let grandNewParticipants = 0, grandNewSuccessEth = 0;
  let earliestTs = null;
  let hasActivity = false;
  const handledICs = new Set(); // ICs matched to on-chain fee contracts

  for (const [chainKey, chain] of Object.entries(CHAINS)) {
    const prevChain = state[chainKey] ?? { campaigns: {} };
    const newChain  = { campaigns: {} };

    let campaigns;
    try { campaigns = await discoverCampaigns(chain); }
    catch (e) { lines.push(`❌ *${chain.name}*: ${e.message}`); continue; }
    if (campaigns.length === 0) continue;

    const tableRows = [];

    for (const camp of campaigns) {
      const ic   = await getIntelligentContract(chain.apiBase, camp.address);
      const meta = (ic && rallyByIC[ic]) ?? null;
      if (ic) handledICs.add(ic.toLowerCase());

      // Campaign metadata
      const title      = meta?.title ? `*${meta.title}*` : `\`${camp.address.slice(0,6)}…${camp.address.slice(-4)}\``;
      const creator    = meta?.displayCreator?.xUsername ?? null;
      const periods    = meta?.campaignDurationPeriods ?? 1;
      const periodDays = meta?.periodLengthDays ?? 0;
      const totalDays  = periods * periodDays;
      const startDate  = meta?.startDate ? new Date(meta.startDate) : null;
      const endDate    = meta?.endDate   ? new Date(meta.endDate)   : null;
      const ageDays    = startDate ? (nowMs - startDate.getTime()) / DAY_MS : null;
      const remainDays = endDate   ? Math.max(0, (endDate.getTime() - nowMs) / DAY_MS) : null;
      const reward     = meta?.campaignRewards?.[0];
      const prizeStr   = reward ? `${Number(reward.totalAmount).toLocaleString()} ${meta.token?.symbol ?? ''}` : null;
      const minFol     = meta?.minimumFollowers ?? null;
      const url        = `${chain.explorer}/address/${camp.address}`;
      const prev       = prevChain.campaigns[camp.address] ?? { participants: 0, successWei: '0', failedWei: '0', successTxs: 0 };

      // On-chain stats
      let oc;
      try { oc = await getCampaignOnChainStats(chain.apiBase, camp.address); }
      catch (e) { lines.push(`  ⚠️ \`${camp.address.slice(0,6)}…${camp.address.slice(-4)}\`: ${e.message}`); continue; }

      // Rally API submissions
      let rallySubs = [], rallyApproved = 0, rallyRejected = 0, rallyUsers = 0, avgScore = null;
      if (ic && rallyByIC[ic]) {
        try {
          rallySubs    = await fetchRallySubmissions(ic);
          rallyRejected = rallySubs.filter(s => s.disqualifiedAt || s.hiddenAt || s.invalidatedAt).length;
          rallyApproved = rallySubs.length - rallyRejected;
          rallyUsers   = new Set(rallySubs.map(s => s.userXId)).size;
          const scores = rallySubs.filter(s => s.atemporalPoints)
                                   .map(s => Number(BigInt(s.atemporalPoints)) / 1e18);
          avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
        } catch {}
      }

      // Save state
      newChain.campaigns[camp.address] = {
        participants: oc.participants,
        successTxs:   oc.successTxs,
        successWei:   oc.successWei,
        failedWei:    oc.failedWei,
      };

      // Deltas vs last run
      const newParticipants = Math.max(0, oc.participants - (prev.participants ?? 0));
      const prevSuccessWei  = BigInt(prev.successWei ?? prev.totalFeesWei ?? '0');
      const newSuccessWei   = BigInt(oc.successWei) - prevSuccessWei;
      const newSuccessEth   = Number(newSuccessWei < 0n ? 0n : newSuccessWei) / 1e18;
      const newSuccessUsd   = newSuccessEth * ethPrice;

      const successUsd = oc.successEth * ethPrice;
      const failedUsd  = oc.failedEth  * ethPrice;

      // Accumulate grand totals
      grandSuccessUsd      += successUsd;
      grandFailedUsd       += failedUsd;
      grandParticipants    += oc.participants;
      grandRallyUsers      += rallyUsers;
      grandSuccessTxs      += oc.successTxs;
      grandFailedTxs       += oc.failedTxs;
      grandNewParticipants += newParticipants;
      grandNewSuccessEth   += newSuccessEth;
      if (oc.firstTs && (!earliestTs || oc.firstTs < earliestTs)) earliestTs = oc.firstTs;
      if (newParticipants > 0 || newSuccessWei > 0n) hasActivity = true;

      // ── Per-campaign ARR projection ─────────────────────────────────────
      // Use on-chain age for rate; extrapolate across all periods
      const chainAgeDays = oc.firstTs ? (nowMs - oc.firstTs) / DAY_MS : ageDays;
      const dailyRate    = (chainAgeDays && chainAgeDays > 0.1) ? successUsd / chainAgeDays : null;
      let arrLine = '';
      if (dailyRate && totalDays > 0) {
        const projPeriod1 = dailyRate * periodDays;
        const projAll     = projPeriod1 * periods;
        const cycles      = 365 / totalDays;
        const arr         = projAll * cycles;
        arrLine = `\n  📊 ${fmt(dailyRate)}/day → proj ${fmt(projAll)} this campaign`;
        if (periods > 1) arrLine += ` (${periods} periods)`;
        arrLine += ` → ${fmt(arr)} ARR`;
      }

      // ── Issues / anomalies ──────────────────────────────────────────────
      const issues = [];
      if (oc.failedTxs > 0)
        issues.push(`⚠️ ${oc.failedTxs} failed txs paid ${fmt(failedUsd)} (kept by platform?)`);
      if (rallyUsers > 0 && oc.participants > 0) {
        const gap = rallyUsers - oc.participants;
        if (gap > 5)  issues.push(`⚠️ ${gap} users in Rally but no on-chain tx (funnel leak)`);
        if (gap < -3) issues.push(`⚠️ ${Math.abs(gap)} on-chain wallets not in Rally (ghost txs?)`);
      }
      if (avgScore !== null && avgScore < 1.0)
        issues.push(`⚠️ Low avg score ${avgScore.toFixed(2)} — content quality issue`);
      if (rallyApproved > 0 && oc.successTxs > 0) {
        const approvalRate = rallyApproved / oc.successTxs;
        if (approvalRate < 0.5)
          issues.push(`⚠️ Only ${(approvalRate*100).toFixed(0)}% of paid subs approved by AI`);
      }

      // ── Collect row for table (skip truly dead campaigns) ───────────────
      if (oc.participants === 0 && rallyUsers === 0 && oc.successTxs === 0) continue;

      const shortName = (meta?.title ?? camp.address.slice(0,6)+'…'+camp.address.slice(-4))
        .replace('Argumentation Markets Are the Next Primitive', 'Argue Markets')
        .replace('RALLY BETA IS LIVE , SAY IT LOUD', 'Rally Beta')
        .slice(0, 22);

      const deltaP = newParticipants > 0 ? `+${newParticipants}` : '';
      const deltaF = newSuccessUsd > 0   ? `+${fmt(newSuccessUsd)}` : '';
      // Projected total revenue for this campaign's full duration
      const projStr = dailyRate && totalDays > 0
        ? fmt(dailyRate * totalDays)
        : '-';
      const scoreStr = avgScore !== null ? avgScore.toFixed(1) : '-';
      const remainStr = remainDays != null ? `${Math.ceil(remainDays)}d` : '-';

      // Store row data for table rendering after loop
      tableRows.push({ shortName, url, oc, rallyUsers, successUsd, newParticipants, deltaP, newSuccessUsd, deltaF, scoreStr, rallyApproved, rallyRejected, projStr, remainStr, periods, prizeStr, issues });
    }

    if (tableRows.length === 0) { state[chainKey] = newChain; continue; }

    // ── Render table for this chain ────────────────────────────────────────
    // Column widths
    const W = { name: 22, wall: 6, rev: 8, pot: 10, score: 5, arr: 7, left: 4 };
    const pad = (s, n, r=false) => r ? String(s).padStart(n) : String(s).padEnd(n);

    const header =
      pad('Campaign', W.name) + ' ' +
      pad('Wall', W.wall, true) + ' ' +
      pad('Rev', W.rev, true) + ' ' +
      pad('Pot', W.pot, true) + ' ' +
      pad('Score', W.score, true) + ' ' +
      pad('Proj', W.arr, true) + ' ' +
      pad('Left', W.left, true);
    const divider = '─'.repeat(header.length);

    const tableLines = [header, divider];
    for (const r of tableRows) {
      const wallStr = r.deltaP ? `${r.oc.participants}(${r.deltaP})` : String(r.oc.participants);
      const revStr  = r.deltaF ? `${fmt(r.successUsd).replace('$','')}(${r.deltaF.replace('$','')})` : fmt(r.successUsd).replace('$','');
      // Shorten prize: 450000000 ARGUE → 450M ARGUE, 5000 USDT → 5K USDT
      const potStr = r.prizeStr ? (() => {
        const m = r.prizeStr.match(/^([\d,]+)\s+(\S+)$/);
        if (!m) return r.prizeStr.slice(0, W.pot);
        const n = parseFloat(m[1].replace(/,/g, ''));
        const sym = m[2];
        const short = n >= 1e9 ? `${(n/1e9).toFixed(0)}B` :
                      n >= 1e6 ? `${(n/1e6).toFixed(0)}M` :
                      n >= 1e3 ? `${(n/1e3).toFixed(0)}K` : String(n);
        return `${short} ${sym}`.slice(0, W.pot);
      })() : '-';
      tableLines.push(
        pad(r.shortName, W.name) + ' ' +
        pad(wallStr, W.wall, true) + ' ' +
        pad(revStr,  W.rev,  true) + ' ' +
        pad(potStr,  W.pot,  true) + ' ' +
        pad(r.scoreStr+'/5', W.score, true) + ' ' +
        pad(r.projStr, W.arr, true) + ' ' +
        pad(r.remainStr, W.left, true)
      );
    }

    // Issues — one line per campaign
    const issueLines = tableRows.flatMap(r =>
      r.issues.map(i => `  ${r.shortName.trim()}: ${i}`)
    );

    state[chainKey] = newChain;
    lines.push(`🔗 *${chain.name}* (fee campaigns)`);
    lines.push('```');
    lines.push(tableLines.join('\n'));
    lines.push('```');
    if (issueLines.length) lines.push(issueLines.join('\n'));
  }

  // ── Legacy free campaigns (pre-fee version, Rally API only) ─────────────
  // Fee campaigns are identified by having an on-chain contract via factory logs.
  // We track which ICs were matched to an on-chain contract during the loop above.
  const freeActiveCamps = allRallyCampaigns.filter(c => {
    const ic = (c.intelligentContractAddress ?? '').toLowerCase();
    const ended = new Date(c.endDate) <= new Date();
    return !ended && !handledICs.has(ic);
  });

  if (freeActiveCamps.length > 0) {
    const prevFree = state._freeCamps ?? {};
    const newFree  = {};

    const WF = { name: 26, users: 6, subs: 12, score: 5, pot: 10, left: 4 };
    const padF = (s, n, r=false) => r ? String(s).padStart(n) : String(s).padEnd(n);
    const fHeader =
      padF('Campaign', WF.name) + ' ' +
      padF('Users', WF.users, true) + ' ' +
      padF('Subs(✓/✗)', WF.subs, true) + ' ' +
      padF('Score', WF.score, true) + ' ' +
      padF('Pot', WF.pot, true) + ' ' +
      padF('Left', WF.left, true);
    const fDivider = '─'.repeat(fHeader.length);
    const fRows = [fHeader, fDivider];

    let totalFreeUsers = 0, totalFreeSubs = 0;

    for (const camp of freeActiveCamps) {
      const ic = camp.intelligentContractAddress;
      const shortName = camp.title
        .replace('Argumentation Markets Are the Next Primitive', 'Argue Markets')
        .replace('AI Agents Are Taking Over the Internet.. But Can They Argue?', 'AI Agents Argue?')
        .replace('Building Trust in the Agent Economy with Internet Court', 'InternetCourt Trust')
        .replace('Agents Are Coming, Are We Ready?', 'Agents Are Coming')
        .slice(0, WF.name);

      let subs = [], approved = 0, rejected = 0, users = 0, avgScore = null;
      try {
        subs     = Object.values(await fetchRallySubmissions(ic));
        rejected = subs.filter(s => s.disqualifiedAt || s.hiddenAt || s.invalidatedAt).length;
        approved = subs.length - rejected;
        users    = new Set(subs.map(s => s.userXId)).size;
        const scores = subs.filter(s => s.atemporalPoints).map(s => Number(BigInt(s.atemporalPoints)) / 1e18);
        avgScore = scores.length ? scores.reduce((a,b) => a+b, 0) / scores.length : 0;
      } catch {}

      const prev      = prevFree[ic] ?? { users: 0, subs: 0 };
      const newUsers  = Math.max(0, users - (prev.users ?? 0));
      const newSubs   = Math.max(0, subs.length - (prev.subs ?? 0));
      newFree[ic]     = { users, subs: subs.length };

      const reward    = camp.campaignRewards?.[0];
      const potStr    = reward ? (() => {
        const n   = Number(reward.totalAmount);
        const sym = camp.token?.symbol ?? '';
        const s   = n >= 1e9 ? `${(n/1e9).toFixed(0)}B` : n >= 1e6 ? `${(n/1e6).toFixed(0)}M` : n >= 1e3 ? `${(n/1e3).toFixed(0)}K` : String(n);
        return `${s} ${sym}`.slice(0, WF.pot);
      })() : '-';
      const remainDays = Math.max(0, (new Date(camp.endDate) - new Date()) / DAY_MS);
      const remainStr  = `${Math.ceil(remainDays)}d`;
      const scoreStr   = avgScore !== null ? avgScore.toFixed(1) : '-';
      const subsStr    = `${subs.length}(${approved}✓${rejected}✗)`;
      const usersStr   = newUsers > 0 ? `${users}(+${newUsers})` : String(users);

      totalFreeUsers += users;
      totalFreeSubs  += subs.length;
      if (newUsers > 0 || newSubs > 0) hasActivity = true;

      fRows.push(
        padF(shortName, WF.name) + ' ' +
        padF(usersStr,  WF.users, true) + ' ' +
        padF(subsStr,   WF.subs,  true) + ' ' +
        padF(scoreStr+'/5', WF.score, true) + ' ' +
        padF(potStr,    WF.pot,   true) + ' ' +
        padF(remainStr, WF.left,  true)
      );
    }

    state._freeCamps = newFree;
    lines.push(`\n🎁 *RLP campaigns* _(legacy free, fee coming)_`);
    lines.push('```');
    lines.push(fRows.join('\n'));
    lines.push('```');
    lines.push(`  ${totalFreeUsers} users | ${totalFreeSubs} subs total`);
  }

  // ── Grand summary ────────────────────────────────────────────────────────
  const newSuccessUsd = grandNewSuccessEth * ethPrice;
  const totalRevenue  = grandSuccessUsd;
  const fmtR = fmt;

  // ARR: on-chain since-launch (most accurate)
  const arrParts = [];
  if (earliestTs && totalRevenue > 0) {
    const ageMs   = nowMs - earliestTs;
    const ageDays = ageMs / DAY_MS;
    if (ageDays >= 0.5) {
      const d   = totalRevenue / ageDays;
      const arr = d * 365;
      const ageFmt = ageDays >= 7 ? `${Math.round(ageDays/7)}w` : `${ageDays.toFixed(1)}d`;
      arrParts.push(`since launch (${ageFmt}): *${fmtR(d)}/day → ${fmtR(arr)} ARR*`);
    }
  }
  // 24h snapshot
  const snap24 = snapshotDelta(state, DAY_MS);
  if (snap24) {
    const d = totalRevenue - snap24.totalFeesUsd;
    if (d > 0) arrParts.push(`24h: *${fmtR(d)}/day → ${fmtR(d * 365)} ARR*`);
  }
  // 7d snapshot
  const snap7d = snapshotDelta(state, 7 * DAY_MS);
  if (snap7d) {
    const d = (totalRevenue - snap7d.totalFeesUsd) / 7;
    if (d > 0) arrParts.push(`7d: *${fmtR(d)}/day → ${fmtR(d * 365)} ARR*`);
  }
  if (arrParts.length === 0 && newSuccessUsd > 0) {
    const d = newSuccessUsd * 24;
    arrParts.push(`1h est: *${fmtR(d)}/day → ${fmtR(d * 365)} ARR*`);
  }

  addSnapshot(state, totalRevenue);
  saveState(state);

  // ── Summary block ────────────────────────────────────────────────────────
  const newSuccessUsdTotal = grandNewSuccessEth * ethPrice;
  const deltaStr = grandNewParticipants > 0 && newSuccessUsdTotal > 0
    ? ` (+${grandNewParticipants} / +${fmt(newSuccessUsdTotal)})`
    : '';
  const arrStr = arrParts.length > 0 ? arrParts[0] : null; // most accurate one

  lines.push('');
  lines.push(
    `📊 *${grandParticipants} wallets* | *${grandRallyUsers} Rally users* | *${fmt(totalRevenue)} rev*${deltaStr}`
  );
  if (arrStr) lines.push(`💹 ${arrStr} 📈`);

  const flags = [];
  if (grandFailedTxs > 0)
    flags.push(`⚠️ ${grandFailedTxs} failed txs — ${fmt(grandFailedUsd)} kept?`);
  if (grandParticipants - grandRallyUsers > 5)
    flags.push(`⚠️ ${grandParticipants - grandRallyUsers} ghost wallets (paid, not in Rally)`);
  if (flags.length) lines.push(flags.join(' | '));

  const msg = lines.join('\n');
  console.log(msg);

  if (hasActivity) {
    process.stdout.write('\n---TELEGRAM_MSG---\n' + msg + '\n---END---\n');
  } else {
    console.log('\nNO_ACTIVITY');
  }
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
