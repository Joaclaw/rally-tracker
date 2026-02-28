'use client';

import { useEffect, useState } from 'react';

interface Campaign {
  title: string;
  address: string;
  creator: string | null;
  prize: string | null;
  users: number;
  submissions: number;
  approved: number;
  rejected: number;
  avgScore: number;
  remainDays: number;
  revenueUsd: number | null;
  participants: number | null;
  failedTxs: number;
  ghostWallets: number;
  phase: 'alpha' | 'beta';
  chainId: number;
  symbol: string;
}

interface Data {
  timestamp: string;
  cachedAt: string | null;
  ethPrice: number;
  campaigns: Campaign[];
  stats: {
    totalCampaigns: number;
    activeCampaigns: number;
    totalUsers: number;
    totalSubmissions: number;
    totalRevenue: number;
    totalParticipants: number;
    totalRallyUsers: number;
    totalFailedTxs: number;
    totalFailedUsd: number;
    ghostWallets: number;
    arr: number | null;
    dailyRate: number | null;
    ageDays: number | null;
  };
}

const formatUsd = (n: number | null | undefined) => {
  if (n == null || n === 0) return '-';
  if (n >= 1000) return `$${Math.round(n).toLocaleString()}`;
  return `$${n.toFixed(2)}`;
};

export default function Home() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/campaigns');
      if (!res.ok) throw new Error('Failed to fetch');
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000);
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
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-xl flex items-center justify-center">
              <span className="text-xl">⚡</span>
            </div>
            <div>
              <h1 className="text-xl font-bold">Rally Tracker</h1>
              <p className="text-xs text-gray-500">Campaign analytics</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block">
              <p className="text-sm text-gray-400">ETH</p>
              <p className="font-mono font-bold text-green-400">${data?.ethPrice?.toLocaleString() ?? '-'}</p>
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

      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="bg-gradient-to-br from-green-500/10 to-emerald-500/10 border border-green-500/20 rounded-xl p-4">
            <p className="text-xs text-green-500/80 uppercase tracking-wider">Revenue</p>
            <p className="text-2xl font-bold text-green-400">{formatUsd(data?.stats.totalRevenue ?? 0)}</p>
          </div>
          <div className="bg-gradient-to-br from-blue-500/10 to-cyan-500/10 border border-blue-500/20 rounded-xl p-4">
            <p className="text-xs text-blue-500/80 uppercase tracking-wider">Wallets</p>
            <p className="text-2xl font-bold text-blue-400">{data?.stats.totalParticipants || data?.stats.totalUsers}</p>
          </div>
          <div className="bg-gradient-to-br from-yellow-500/10 to-orange-500/10 border border-yellow-500/20 rounded-xl p-4">
            <p className="text-xs text-yellow-500/80 uppercase tracking-wider">Est. ARR</p>
            <p className="text-2xl font-bold text-yellow-400">{formatUsd(data?.stats.arr)}</p>
          </div>
          <div className="bg-gradient-to-br from-purple-500/10 to-pink-500/10 border border-purple-500/20 rounded-xl p-4">
            <p className="text-xs text-purple-500/80 uppercase tracking-wider">Daily Rate</p>
            <p className="text-2xl font-bold text-purple-400">{formatUsd(data?.stats.dailyRate)}/d</p>
          </div>
        </div>
        
        {/* Secondary stats row */}
        <div className="grid grid-cols-4 gap-3 mb-6 text-center">
          <div className="bg-gray-800/30 rounded-lg py-2">
            <p className="text-lg font-semibold">{data?.stats.activeCampaigns}</p>
            <p className="text-xs text-gray-500">Active</p>
          </div>
          <div className="bg-gray-800/30 rounded-lg py-2">
            <p className="text-lg font-semibold">{data?.stats.totalRallyUsers || data?.stats.totalUsers}</p>
            <p className="text-xs text-gray-500">Rally Users</p>
          </div>
          <div className="bg-gray-800/30 rounded-lg py-2">
            <p className="text-lg font-semibold">{data?.stats?.totalSubmissions?.toLocaleString() ?? '-'}</p>
            <p className="text-xs text-gray-500">Submissions</p>
          </div>
          <div className="bg-gray-800/30 rounded-lg py-2">
            <p className="text-lg font-semibold">{data?.stats.ageDays?.toFixed(1) ?? '-'}d</p>
            <p className="text-xs text-gray-500">Age</p>
          </div>
        </div>

        {/* Alerts */}
        {((data?.stats.ghostWallets ?? 0) > 0 || (data?.stats.totalFailedTxs ?? 0) > 0) && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 mb-6 flex flex-wrap gap-3 text-sm">
            {(data?.stats.ghostWallets ?? 0) > 0 && (
              <span className="text-red-400">⚠️ {data?.stats.ghostWallets} ghost wallets (paid, not in Rally)</span>
            )}
            {(data?.stats.totalFailedTxs ?? 0) > 0 && (
              <span className="text-red-400">⚠️ {data?.stats.totalFailedTxs} failed txs — {formatUsd(data?.stats.totalFailedUsd)} kept</span>
            )}
          </div>
        )}

        {/* Beta Campaigns (Fee) */}
        {(() => {
          const betaCampaigns = data?.campaigns.filter(c => c.phase === 'beta') ?? [];
          const alphaCampaigns = data?.campaigns.filter(c => c.phase === 'alpha') ?? [];
          
          return (
            <>
              {/* Beta Section */}
              <div className="mb-8">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xl">🔗</span>
                  <h2 className="text-lg font-bold">Beta Campaigns</h2>
                  <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full">Base • Fees</span>
                </div>
                
                {/* Desktop Table */}
                <div className="hidden md:block bg-gray-900/30 rounded-xl border border-gray-800 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-400 border-b border-gray-800 bg-gray-900/50">
                        <th className="px-4 py-3 font-medium">Campaign</th>
                        <th className="px-4 py-3 font-medium text-right">Revenue</th>
                        <th className="px-4 py-3 font-medium text-right">Wallets</th>
                        <th className="px-4 py-3 font-medium text-right">Subs</th>
                        <th className="px-4 py-3 font-medium text-right">Score</th>
                        <th className="px-4 py-3 font-medium text-right">Prize</th>
                        <th className="px-4 py-3 font-medium text-right">Left</th>
                      </tr>
                    </thead>
                    <tbody>
                      {betaCampaigns.map((camp, i) => (
                        <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                          <td className="px-4 py-3">
                            <p className="font-medium truncate max-w-[200px]">{camp.title}</p>
                            <p className="text-xs text-gray-500">@{camp.creator ?? 'unknown'}</p>
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-green-400">{formatUsd(camp.revenueUsd)}</td>
                          <td className="px-4 py-3 text-right font-mono">{camp.participants ?? '-'}</td>
                          <td className="px-4 py-3 text-right font-mono">
                            <span className="text-green-400">{camp.approved}</span>
                            {camp.rejected > 0 && <span className="text-red-400 ml-1">/{camp.rejected}</span>}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className={`font-mono ${camp.avgScore < 1 ? 'text-red-400' : camp.avgScore < 2 ? 'text-yellow-400' : 'text-green-400'}`}>
                              {camp.avgScore > 0 ? camp.avgScore.toFixed(1) : '-'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-xs text-gray-400">{camp.prize}</td>
                          <td className="px-4 py-3 text-right font-mono text-gray-400">{camp.remainDays}d</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Cards */}
                <div className="md:hidden space-y-3">
                  {betaCampaigns.map((camp, i) => (
                    <div key={i} className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex-1 min-w-0 pr-3">
                          <p className="font-semibold truncate">{camp.title}</p>
                          <p className="text-xs text-gray-500">@{camp.creator ?? 'unknown'} • {camp.prize}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-green-400">{formatUsd(camp.revenueUsd)}</p>
                          <p className="text-xs text-gray-500">{camp.remainDays}d left</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="bg-gray-800/50 rounded-lg py-2">
                          <p className="text-xs text-gray-500">Wallets</p>
                          <p className="font-mono font-semibold">{camp.participants ?? '-'}</p>
                        </div>
                        <div className="bg-gray-800/50 rounded-lg py-2">
                          <p className="text-xs text-gray-500">Subs</p>
                          <p className="font-mono font-semibold text-green-400">{camp.approved}</p>
                        </div>
                        <div className="bg-gray-800/50 rounded-lg py-2">
                          <p className="text-xs text-gray-500">Score</p>
                          <p className={`font-mono font-semibold ${camp.avgScore < 1 ? 'text-red-400' : camp.avgScore < 2 ? 'text-yellow-400' : 'text-green-400'}`}>
                            {camp.avgScore > 0 ? camp.avgScore.toFixed(1) : '-'}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Alpha Section */}
              {alphaCampaigns.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xl">🎁</span>
                    <h2 className="text-lg font-bold">Alpha Campaigns</h2>
                    <span className="text-xs bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded-full">GenLayer • RLP</span>
                    <span className="text-xs text-gray-500">(no fees)</span>
                  </div>
                  
                  {/* Desktop Table */}
                  <div className="hidden md:block bg-gray-900/30 rounded-xl border border-purple-500/20 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-gray-400 border-b border-gray-800 bg-gray-900/50">
                          <th className="px-4 py-3 font-medium">Campaign</th>
                          <th className="px-4 py-3 font-medium text-right">Users</th>
                          <th className="px-4 py-3 font-medium text-right">Subs</th>
                          <th className="px-4 py-3 font-medium text-right">Score</th>
                          <th className="px-4 py-3 font-medium text-right">Prize</th>
                          <th className="px-4 py-3 font-medium text-right">Left</th>
                        </tr>
                      </thead>
                      <tbody>
                        {alphaCampaigns.map((camp, i) => (
                          <tr key={i} className="border-b border-gray-800/50 hover:bg-purple-500/5 transition-colors">
                            <td className="px-4 py-3">
                              <p className="font-medium truncate max-w-[240px]">{camp.title}</p>
                              <p className="text-xs text-gray-500">@{camp.creator ?? 'unknown'}</p>
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-purple-400">{camp.users}</td>
                            <td className="px-4 py-3 text-right font-mono">
                              <span className="text-green-400">{camp.approved}</span>
                              {camp.rejected > 0 && <span className="text-red-400 ml-1">/{camp.rejected}</span>}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className={`font-mono ${camp.avgScore < 1 ? 'text-red-400' : camp.avgScore < 2 ? 'text-yellow-400' : 'text-green-400'}`}>
                                {camp.avgScore > 0 ? camp.avgScore.toFixed(1) : '-'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right text-xs text-gray-400">{camp.prize}</td>
                            <td className="px-4 py-3 text-right font-mono text-gray-400">{camp.remainDays}d</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Cards */}
                  <div className="md:hidden space-y-3">
                    {alphaCampaigns.map((camp, i) => (
                      <div key={i} className="bg-purple-500/5 border border-purple-500/20 rounded-xl p-4">
                        <div className="flex justify-between items-start mb-3">
                          <div className="flex-1 min-w-0 pr-3">
                            <p className="font-semibold truncate">{camp.title}</p>
                            <p className="text-xs text-gray-500">@{camp.creator ?? 'unknown'} • {camp.prize}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-lg font-bold text-purple-400">{camp.users} users</p>
                            <p className="text-xs text-gray-500">{camp.remainDays}d left</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-center">
                          <div className="bg-gray-800/50 rounded-lg py-2">
                            <p className="text-xs text-gray-500">Subs</p>
                            <p className="font-mono font-semibold text-green-400">{camp.approved}</p>
                          </div>
                          <div className="bg-gray-800/50 rounded-lg py-2">
                            <p className="text-xs text-gray-500">Score</p>
                            <p className={`font-mono font-semibold ${camp.avgScore < 1 ? 'text-red-400' : camp.avgScore < 2 ? 'text-yellow-400' : 'text-green-400'}`}>
                              {camp.avgScore > 0 ? camp.avgScore.toFixed(1) : '-'}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  <p className="text-xs text-gray-500 mt-2 text-center">
                    Alpha campaigns run on GenLayer (chain 61899) — no on-chain fees tracked
                  </p>
                </div>
              )}
            </>
          );
        })()}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 py-4 mt-8">
        <div className="max-w-6xl mx-auto px-4 text-center text-xs text-gray-500">
          Updated: {data?.timestamp ? new Date(data.timestamp).toLocaleString() : '-'} • Auto-refresh 60s
        </div>
      </footer>
    </div>
  );
}
