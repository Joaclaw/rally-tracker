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
}

interface Data {
  timestamp: string;
  ethPrice: number;
  campaigns: Campaign[];
  stats: {
    totalCampaigns: number;
    activeCampaigns: number;
    totalUsers: number;
    totalSubmissions: number;
  };
}

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

      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="bg-gradient-to-br from-yellow-500/10 to-orange-500/10 border border-yellow-500/20 rounded-xl p-4">
            <p className="text-xs text-yellow-500/80 uppercase tracking-wider">Active</p>
            <p className="text-2xl font-bold text-yellow-400">{data?.stats.activeCampaigns}</p>
          </div>
          <div className="bg-gradient-to-br from-blue-500/10 to-cyan-500/10 border border-blue-500/20 rounded-xl p-4">
            <p className="text-xs text-blue-500/80 uppercase tracking-wider">Total Campaigns</p>
            <p className="text-2xl font-bold text-blue-400">{data?.stats.totalCampaigns}</p>
          </div>
          <div className="bg-gradient-to-br from-green-500/10 to-emerald-500/10 border border-green-500/20 rounded-xl p-4">
            <p className="text-xs text-green-500/80 uppercase tracking-wider">Users</p>
            <p className="text-2xl font-bold text-green-400">{data?.stats.totalUsers.toLocaleString()}</p>
          </div>
          <div className="bg-gradient-to-br from-purple-500/10 to-pink-500/10 border border-purple-500/20 rounded-xl p-4">
            <p className="text-xs text-purple-500/80 uppercase tracking-wider">Submissions</p>
            <p className="text-2xl font-bold text-purple-400">{data?.stats.totalSubmissions.toLocaleString()}</p>
          </div>
        </div>

        {/* Campaigns Table - Desktop */}
        <div className="hidden md:block bg-gray-900/30 rounded-xl border border-gray-800 overflow-hidden">
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
              {data?.campaigns.map((camp, i) => (
                <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium truncate max-w-[280px]">{camp.title}</p>
                    <p className="text-xs text-gray-500">@{camp.creator ?? 'unknown'}</p>
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{camp.users}</td>
                  <td className="px-4 py-3 text-right font-mono">
                    <span className="text-green-400">{camp.approved}</span>
                    {camp.rejected > 0 && <span className="text-red-400 ml-1">/{camp.rejected}</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={`font-mono ${camp.avgScore < 1 ? 'text-red-400' : camp.avgScore < 2 ? 'text-yellow-400' : 'text-green-400'}`}>
                      {camp.avgScore > 0 ? camp.avgScore.toFixed(1) : '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-gray-400">{camp.prize ?? '-'}</td>
                  <td className="px-4 py-3 text-right font-mono text-gray-400">{camp.remainDays}d</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Campaigns Cards - Mobile */}
        <div className="md:hidden space-y-3">
          {data?.campaigns.map((camp, i) => (
            <div key={i} className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
              <div className="flex justify-between items-start mb-3">
                <div className="flex-1 min-w-0 pr-3">
                  <p className="font-semibold truncate">{camp.title}</p>
                  <p className="text-xs text-gray-500">@{camp.creator ?? 'unknown'}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-gray-400">{camp.prize ?? '-'}</p>
                  <p className="text-xs text-gray-500">{camp.remainDays}d left</p>
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
                  <p className={`font-mono font-semibold ${camp.avgScore < 1 ? 'text-red-400' : camp.avgScore < 2 ? 'text-yellow-400' : 'text-green-400'}`}>
                    {camp.avgScore > 0 ? camp.avgScore.toFixed(1) : '-'}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
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
