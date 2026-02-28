import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface RallyCampaign {
  title: string;
  intelligentContractAddress?: string;
  campaignContractAddress?: string;
  displayCreator?: { xUsername?: string };
  campaignRewards?: { totalAmount: string }[];
  token?: { symbol?: string };
  startDate: string;
  endDate: string;
  campaignDurationPeriods?: number;
  periodLengthDays?: number;
}

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

async function getEthPrice(): Promise<number> {
  try {
    const d = await fetchJson('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
    return d.ethereum?.usd ?? 2000;
  } catch {
    return 2000;
  }
}

async function fetchRallyCampaigns(): Promise<RallyCampaign[]> {
  const all: RallyCampaign[] = [];
  for (let page = 1; page <= 5; page++) {
    try {
      const d = await fetchJson(`https://app.rally.fun/api/campaigns?page=${page}&limit=50`);
      all.push(...(d.campaigns ?? []));
      if (!d.pagination?.hasNext) break;
    } catch {
      break;
    }
  }
  return all;
}

async function fetchSubmissions(ic: string) {
  try {
    const raw = await fetchJson(`https://app.rally.fun/api/submissions?campaignAddress=${ic}&limit=5000`, 8000);
    return Array.isArray(raw) ? raw : Object.values(raw);
  } catch {
    return [];
  }
}

function formatPrize(reward: { totalAmount: string } | undefined, symbol: string | undefined): string | null {
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
    const [ethPrice, allCampaigns] = await Promise.all([
      getEthPrice(),
      fetchRallyCampaigns(),
    ]);

    const now = new Date();
    const activeCampaigns = allCampaigns.filter(c => new Date(c.endDate) > now);

    // Fetch submissions for active campaigns (parallel, max 10)
    const campaignsWithStats = await Promise.all(
      activeCampaigns.slice(0, 15).map(async (camp) => {
        const ic = camp.intelligentContractAddress;
        let users = 0, submissions = 0, approved = 0, rejected = 0, avgScore = 0;

        if (ic) {
          const subs = await fetchSubmissions(ic);
          submissions = subs.length;
          rejected = subs.filter((s: any) => s.disqualifiedAt || s.hiddenAt || s.invalidatedAt).length;
          approved = submissions - rejected;
          users = new Set(subs.map((s: any) => s.userXId)).size;
          
          const scores = subs
            .filter((s: any) => s.atemporalPoints)
            .map((s: any) => {
              try { return Number(BigInt(s.atemporalPoints)) / 1e18; }
              catch { return 0; }
            });
          avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
        }

        const remainDays = Math.max(0, (new Date(camp.endDate).getTime() - now.getTime()) / 86400000);

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
          startDate: camp.startDate,
          endDate: camp.endDate,
        };
      })
    );

    // Sort by users desc
    campaignsWithStats.sort((a, b) => b.users - a.users);

    // Stats
    const totalUsers = campaignsWithStats.reduce((sum, c) => sum + c.users, 0);
    const totalSubmissions = campaignsWithStats.reduce((sum, c) => sum + c.submissions, 0);

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      ethPrice,
      campaigns: campaignsWithStats,
      stats: {
        totalCampaigns: allCampaigns.length,
        activeCampaigns: activeCampaigns.length,
        totalUsers,
        totalSubmissions,
      },
    });
  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
