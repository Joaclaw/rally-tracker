import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export const dynamic = 'force-dynamic';

// ─── Helpers ────────────────────────────────────────────────────────────────

async function fetchJson(url: string, timeout = 10000) {
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
    const raw = await fetchJson(`https://app.rally.fun/api/submissions?campaignAddress=${ic}&limit=10000`, 8000);
    return Array.isArray(raw) ? raw : Object.values(raw);
  } catch { return []; }
}

// ─── Main Handler ───────────────────────────────────────────────────────────

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
  try {
    const now = new Date();
    const nowMs = now.getTime();

    // Load cached on-chain data
    let cached: any = null;
    const dataPath = join(process.cwd(), 'public', 'data.json');
    if (existsSync(dataPath)) {
      try {
        cached = JSON.parse(readFileSync(dataPath, 'utf8'));
      } catch {}
    }

    // Build IC -> cached data lookup
    const cachedByIC: Record<string, any> = {};
    if (cached?.feeCampaigns) {
      for (const c of cached.feeCampaigns) {
        if (c.ic) cachedByIC[c.ic.toLowerCase()] = c;
      }
    }

    // Fetch live Rally data
    const rallyCampaigns = await fetchRallyCampaigns();
    const activeCampaigns = rallyCampaigns.filter((c: any) => new Date(c.endDate) > now);

    // Process each active campaign
    const campaigns = await Promise.all(
      activeCampaigns.map(async (camp: any) => {
        const ic = (camp.intelligentContractAddress ?? '').toLowerCase();
        const cachedData = ic ? cachedByIC[ic] : null;

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

        // Use cached on-chain data
        const revenueUsd = cachedData?.revenueUsd ?? null;
        const participants = cachedData?.participants ?? null;
        const failedTxs = cachedData?.failedTxs ?? 0;
        const failedUsd = cachedData?.failedUsd ?? 0;
        const ghostWallets = participants != null ? Math.max(0, participants - users) : 0;

        const remainDays = Math.max(0, (new Date(camp.endDate).getTime() - nowMs) / 86400000);

        // Determine if Beta (Base chain with fees) or Alpha (GenLayer/RLP)
        const isBeta = camp.distributionContractChainId === 8453 && camp.token?.symbol !== 'RLP';
        const phase = isBeta ? 'beta' : 'alpha';

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
          phase,
          chainId: camp.distributionContractChainId,
          symbol: camp.token?.symbol,
        };
      })
    );

    // Sort by revenue (fee campaigns first), then by users
    campaigns.sort((a, b) => (b.revenueUsd ?? -1) - (a.revenueUsd ?? -1) || b.users - a.users);

    // Use cached stats
    const stats = cached?.stats ?? {
      totalCampaigns: rallyCampaigns.length,
      activeCampaigns: activeCampaigns.length,
      onChainCampaigns: 0,
      totalRevenue: 0,
      totalParticipants: 0,
      totalRallyUsers: 0,
      totalFailedTxs: 0,
      totalFailedUsd: 0,
      ghostWallets: 0,
      arr: null,
      dailyRate: null,
      ageDays: null,
    };

    // Update some stats with live data
    stats.totalCampaigns = rallyCampaigns.length;
    stats.activeCampaigns = activeCampaigns.length;
    stats.totalUsers = campaigns.reduce((sum, c) => sum + c.users, 0);
    stats.totalSubmissions = campaigns.reduce((sum, c) => sum + c.submissions, 0);

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      cachedAt: cached?.timestamp ?? null,
      campaigns,
      stats,
    });
  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
