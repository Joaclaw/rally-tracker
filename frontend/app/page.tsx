'use client';

import { useEffect, useState } from 'react';

interface Campaign {
  address: string;
  chain?: string;
  chainName?: string;
  explorer?: string;
  title: string;
  creator: string | null;
  participants?: number;
  rallyUsers?: number;
  users?: number;
  submissions?: number;
  successTxs?: number;
  failedTxs?: number;
  revenueEth?: number;
  revenueUsd?: number;
  failedUsd?: number;
  avgScore: number;
  approved: number;
  rejected: number;
  prize: string | null;
  remainDays: number | null;
  projectedRevenue?: number | null;
  dailyRate?: number | null;
  issues?: string[];
  startDate?: string;
  endDate?: string;
}

interface Stats {
  totalRevenue: number;
  totalParticipants: number;
  totalRallyUsers: number;
  totalFailedTxs: number;
  totalFailedUsd: number;
  ghostWallets: number;
  arr: number | null;
  dailyRate: number | null;
}

interface Data {
  timestamp: string;
  ethPrice: number;
  feeCampaigns: Campaign[];
  freeCampaigns: Campaign[];
  stats: Stats;
}

const formatUsd = (n: number) => {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${Math.round(n).toLocaleString()}`;
  return `$${n.toFixed(2)}`;
};

const formatPrize = (prize: string | null) => {
  if (!prize) return '-';
  const match = prize.match(/^([\d,]+)\s+(\S+)$/);
  if (!match) return prize;
  const n = parseFloat(match[1].replace(/,/g, ''));
  const sym = match[2];
  if (n >= 1e9) return `${(n / 1e9).toFixed(0)}B ${sym}`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)}M ${sym}`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K ${sym}`;
  return prize;
};

export default function Home() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/campaigns');
      if (!res.ok) throw new Error('Failed to fetch');
      const json = await res.json();
      setData(json);
      setLastUpdate(new Date());
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, []);

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-yellow-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-400">Loading campaigns...</p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-500 mb-4">{error}</p>
          <button onClick={fetchData} className="px-4 py-2 bg-yellow-500 text-black rounded-lg font-semibold">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Header */}
      <header className="border-b border-gray-800 sticky top-0 bg-[#0a0a0a]/95 backdrop-blur-sm z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-xl flex items-center justify-center">
              <span className="text-xl">⚡</span>
            </div>
            <div>
              <h1 className="text-xl font-bold">Rally Tracker</h1>
              <p className="text-xs text-gray-500">On-chain campaign analytics</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm text-gray-400">ETH Price</p>
              <p className="font-mono font-bold text-green-400">${data?.ethPrice.toLocaleString()}</p>
            </div>
            <button
              onClick={fetchData}
              disabled={loading}
              className="p-2 hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50"
            >
              <svg className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-gradient-to-br from-yellow-500/10 to-orange-500/10 border border-yellow-500/20 rounded-2xl p-4">
            <p className="text-xs text-yellow-500/80 uppercase tracking-wider mb-1">Total Revenue</p>
            <p className="text-2xl font-bold text-yellow-400">{formatUsd(data?.stats.totalRevenue ?? 0)}</p>
          </div>
          <div className="bg-gradient-to-br from-blue-500/10 to-cyan-500/10 border border-blue-500/20 rounded-2xl p-4">
            <p className="text-xs text-blue-500/80 uppercase tracking-wider mb-1">Wallets</p>
            <p className="text-2xl font-bold text-blue-400">{data?.stats.totalParticipants.toLocaleString()}</p>
          </div>
          <div className="bg-gradient-to-br from-green-500/10 to-emerald-500/10 border border-green-500/20 rounded-2xl p-4">
            <p className="text-xs text-green-500/80 uppercase tracking-wider mb-1">Est. ARR</p>
            <p className="text-2xl font-bold text-green-400">{data?.stats.arr ? formatUsd(data.stats.arr) : '-'}</p>
          </div>
          <div className="bg-gradient-to-br from-purple-500/10 to-pink-500/10 border border-purple-500/20 rounded-2xl p-4">
            <p className="text-xs text-purple-500/80 uppercase tracking-wider mb-1">Daily Rate</p>
            <p className="text-2xl font-bold text-purple-400">{data?.stats.dailyRate ? formatUsd(data.stats.dailyRate) : '-'}</p>
          </div>
        </div>

        {/* Alerts */}
        {(data?.stats.ghostWallets ?? 0) > 0 || (data?.stats.totalFailedTxs ?? 0) > 0 ? (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-8 flex flex-wrap gap-4">
            {(data?.stats.ghostWallets ?? 0) > 0 && (
              <div className="flex items-center gap-2 text-red-400">
                <span>⚠️</span>
                <span>{data?.stats.ghostWallets} ghost wallets (paid, not in Rally)</span>
              </div>
            )}
            {(data?.stats.totalFailedTxs ?? 0) > 0 && (
              <div className="flex items-center gap-2 text-red-400">
                <span>⚠️</span>
                <span>{data?.stats.totalFailedTxs} failed txs — {formatUsd(data?.stats.totalFailedUsd ?? 0)} kept</span>
              </div>
            )}
          </div>
        ) : null}

        {/* Fee Campaigns */}
        <section className="mb-12">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xl">🔗</span>
            <h2 className="text-lg font-bold">Fee Campaigns</h2>
            <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">
              {data?.feeCampaigns.length ?? 0} active
            </span>
          </div>
          
          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-800">
                  <th className="pb-3 font-medium">Campaign</th>
                  <th className="pb-3 font-medium text-right">Wallets</th>
                  <th className="pb-3 font-medium text-right">Revenue</th>
                  <th className="pb-3 font-medium text-right">Prize</th>
                  <th className="pb-3 font-medium text-right">Score</th>
                  <th className="pb-3 font-medium text-right">Proj.</th>
                  <th className="pb-3 font-medium text-right">Left</th>
                  <th className="pb-3 font-medium">Issues</th>
                </tr>
              </thead>
              <tbody>
                {data?.feeCampaigns.map((camp) => (
                  <tr key={camp.address} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                    <td className="py-3">
                      <a href={camp.explorer} target="_blank" rel="noopener noreferrer" className="hover:text-yellow-400 transition-colors">
                        <p className="font-medium truncate max-w-[200px]">{camp.title}</p>
                        <p className="text-xs text-gray-500">{camp.chainName} • @{camp.creator ?? 'unknown'}</p>
                      </a>
                    </td>
                    <td className="py-3 text-right font-mono">{camp.participants}</td>
                    <td className="py-3 text-right font-mono text-green-400">{formatUsd(camp.revenueUsd ?? 0)}</td>
                    <td className="py-3 text-right font-mono text-gray-400">{formatPrize(camp.prize)}</td>
                    <td className="py-3 text-right">
                      <span className={`font-mono ${(camp.avgScore ?? 0) < 1 ? 'text-red-400' : (camp.avgScore ?? 0) < 2 ? 'text-yellow-400' : 'text-green-400'}`}>
                        {camp.avgScore?.toFixed(1) ?? '-'}/5
                      </span>
                    </td>
                    <td className="py-3 text-right font-mono text-blue-400">
                      {camp.projectedRevenue ? formatUsd(camp.projectedRevenue) : '-'}
                    </td>
                    <td className="py-3 text-right font-mono text-gray-400">
                      {camp.remainDays != null ? `${Math.ceil(camp.remainDays)}d` : '-'}
                    </td>
                    <td className="py-3">
                      {camp.issues && camp.issues.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {camp.issues.map((issue, i) => (
                            <span key={i} className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded">
                              {issue}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-green-400">✓</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden space-y-3">
            {data?.feeCampaigns.map((camp) => (
              <a
                key={camp.address}
                href={camp.explorer}
                target="_blank"
                rel="noopener noreferrer"
                className="block bg-gray-900/50 border border-gray-800 rounded-xl p-4 hover:border-gray-700 transition-colors"
              >
                <div className="flex justify-between items-start mb-3">
                  <div className="flex-1 min-w-0 pr-3">
                    <p className="font-semibold truncate">{camp.title}</p>
                    <p className="text-xs text-gray-500">{camp.chainName} • @{camp.creator ?? 'unknown'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-green-400">{formatUsd(camp.revenueUsd ?? 0)}</p>
                    <p className="text-xs text-gray-500">{camp.remainDays != null ? `${Math.ceil(camp.remainDays)}d left` : ''}</p>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div className="bg-gray-800/50 rounded-lg py-2">
                    <p className="text-xs text-gray-500">Wallets</p>
                    <p className="font-mono font-semibold">{camp.participants}</p>
                  </div>
                  <div className="bg-gray-800/50 rounded-lg py-2">
                    <p className="text-xs text-gray-500">Score</p>
                    <p className={`font-mono font-semibold ${(camp.avgScore ?? 0) < 1 ? 'text-red-400' : (camp.avgScore ?? 0) < 2 ? 'text-yellow-400' : 'text-green-400'}`}>
                      {camp.avgScore?.toFixed(1) ?? '-'}
                    </p>
                  </div>
                  <div className="bg-gray-800/50 rounded-lg py-2">
                    <p className="text-xs text-gray-500">Proj.</p>
                    <p className="font-mono font-semibold text-blue-400 text-xs">
                      {camp.projectedRevenue ? formatUsd(camp.projectedRevenue) : '-'}
                    </p>
                  </div>
                  <div className="bg-gray-800/50 rounded-lg py-2">
                    <p className="text-xs text-gray-500">Prize</p>
                    <p className="font-mono font-semibold text-gray-400 text-xs truncate px-1">
                      {formatPrize(camp.prize)}
                    </p>
                  </div>
                </div>
                {camp.issues && camp.issues.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-3">
                    {camp.issues.map((issue, i) => (
                      <span key={i} className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded">
                        {issue}
                      </span>
                    ))}
                  </div>
                )}
              </a>
            ))}
          </div>
        </section>

        {/* Free Campaigns */}
        {(data?.freeCampaigns.length ?? 0) > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xl">🎁</span>
              <h2 className="text-lg font-bold">RLP Campaigns</h2>
              <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">
                {data?.freeCampaigns.length ?? 0} active • legacy free
              </span>
            </div>
            
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-800">
                    <th className="pb-3 font-medium">Campaign</th>
                    <th className="pb-3 font-medium text-right">Users</th>
                    <th className="pb-3 font-medium text-right">Submissions</th>
                    <th className="pb-3 font-medium text-right">Score</th>
                    <th className="pb-3 font-medium text-right">Prize</th>
                    <th className="pb-3 font-medium text-right">Left</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.freeCampaigns.map((camp) => (
                    <tr key={camp.address} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                      <td className="py-3">
                        <p className="font-medium truncate max-w-[250px]">{camp.title}</p>
                        <p className="text-xs text-gray-500">@{camp.creator ?? 'unknown'}</p>
                      </td>
                      <td className="py-3 text-right font-mono">{camp.users}</td>
                      <td className="py-3 text-right font-mono">
                        <span className="text-green-400">{camp.approved}✓</span>
                        {camp.rejected > 0 && <span className="text-red-400 ml-1">{camp.rejected}✗</span>}
                      </td>
                      <td className="py-3 text-right">
                        <span className={`font-mono ${(camp.avgScore ?? 0) < 1 ? 'text-red-400' : (camp.avgScore ?? 0) < 2 ? 'text-yellow-400' : 'text-green-400'}`}>
                          {camp.avgScore?.toFixed(1) ?? '-'}/5
                        </span>
                      </td>
                      <td className="py-3 text-right font-mono text-gray-400">{formatPrize(camp.prize)}</td>
                      <td className="py-3 text-right font-mono text-gray-400">
                        {camp.remainDays != null ? `${Math.ceil(camp.remainDays)}d` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden space-y-3">
              {data?.freeCampaigns.map((camp) => (
                <div
                  key={camp.address}
                  className="bg-gray-900/50 border border-gray-800 rounded-xl p-4"
                >
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex-1 min-w-0 pr-3">
                      <p className="font-semibold truncate">{camp.title}</p>
                      <p className="text-xs text-gray-500">@{camp.creator ?? 'unknown'}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-gray-400">{formatPrize(camp.prize)}</p>
                      <p className="text-xs text-gray-500">{camp.remainDays != null ? `${Math.ceil(camp.remainDays)}d left` : ''}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-gray-800/50 rounded-lg py-2">
                      <p className="text-xs text-gray-500">Users</p>
                      <p className="font-mono font-semibold">{camp.users}</p>
                    </div>
                    <div className="bg-gray-800/50 rounded-lg py-2">
                      <p className="text-xs text-gray-500">Subs</p>
                      <p className="font-mono font-semibold">
                        <span className="text-green-400">{camp.approved}</span>
                        {camp.rejected > 0 && <span className="text-red-400">/{camp.rejected}</span>}
                      </p>
                    </div>
                    <div className="bg-gray-800/50 rounded-lg py-2">
                      <p className="text-xs text-gray-500">Score</p>
                      <p className={`font-mono font-semibold ${(camp.avgScore ?? 0) < 1 ? 'text-red-400' : (camp.avgScore ?? 0) < 2 ? 'text-yellow-400' : 'text-green-400'}`}>
                        {camp.avgScore?.toFixed(1) ?? '-'}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 py-6 mt-12">
        <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-gray-500">
          <p>
            Last updated: {lastUpdate?.toLocaleTimeString() ?? '-'} • Auto-refresh every 60s
          </p>
          <div className="flex items-center gap-4">
            <a href="https://rally.fun" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">
              Rally.fun
            </a>
            <a href="https://github.com/Joaclaw/rally-tracker" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
