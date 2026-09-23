import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Search,
  History,
  Tv,
  Radio,
  CheckCircle2,
} from 'lucide-react';
import { fetchCustomerSessions } from '../api';
import { CustomerSessionRecord } from '../types';
import { POLL_INTERVALS } from '../constants';

export const CustomerLogs: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch Live Individual Session Check-in Logs (Admin + Customer Portal Check-ins)
  const {
    data: sessionLogs = [],
    isLoading: isLoadingSessions,
  } = useQuery<CustomerSessionRecord[]>({
    queryKey: ['customer-sessions'],
    queryFn: () => fetchCustomerSessions(),
    refetchInterval: POLL_INTERVALS.CUSTOMERS,
  });

  // Filter for Live Check-in Sessions
  const filteredSessions = useMemo(() => {
    const list = Array.isArray(sessionLogs) ? sessionLogs : [];
    return list.filter((s) => {
      const q = searchQuery.toLowerCase().trim();
      if (!q) return true;
      const name = (s?.customerName || '').toLowerCase();
      const phone = (s?.customerPhone || '').toLowerCase();
      const st = (s?.stationName || '').toLowerCase();
      const status = (s?.status || '').toLowerCase();
      return name.includes(q) || phone.includes(q) || st.includes(q) || status.includes(q);
    });
  }, [sessionLogs, searchQuery]);

  const formatSessionTime = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return (
        d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
        ', ' +
        d.toLocaleDateString([], { month: 'short', day: 'numeric' })
      );
    } catch {
      return isoString;
    }
  };

  return (
    <div className="space-y-4">
      {/* Header Toolbar: Title & Search */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-emerald-400" />
          <span className="font-bold text-white text-sm font-display tracking-wide">
            Session Check-in Logs
          </span>
          <span className="text-[10px] font-mono-code px-2 py-0.5 rounded-full bg-slate-900 border border-slate-800 text-slate-300">
            {sessionLogs.length} Records
          </span>
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-72">
          <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search player, station, phone..."
            className="w-full pl-8 pr-3 py-2 bg-slate-900/90 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500 transition-colors"
          />
        </div>
      </div>

      {/* Session Check-in Logs Table */}
      <div className="bg-slate-900/85 backdrop-blur-xl rounded-3xl border border-slate-800 overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800 uppercase text-[10px] tracking-wider font-mono-code">
              <tr>
                <th className="py-3.5 px-4 sm:px-6">Player Name</th>
                <th className="py-3.5 px-4">Station / Console</th>
                <th className="py-3.5 px-4">Mobile</th>
                <th className="py-3.5 px-4 text-center">Session Status</th>
                <th className="py-3.5 px-4">Started At</th>
                <th className="py-3.5 px-4 text-center">Duration</th>
                <th className="py-3.5 px-4 text-right">Bill / Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {isLoadingSessions && sessionLogs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500 font-mono-code">
                    Loading Session Logs...
                  </td>
                </tr>
              ) : filteredSessions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500">
                    No session records found matching your filter.
                  </td>
                </tr>
              ) : (
                filteredSessions.map((sess) => {
                  const isActive = sess.status === 'ACTIVE';

                  return (
                    <tr key={sess.id} className="hover:bg-slate-800/40 transition-colors">
                      {/* Player */}
                      <td className="py-3.5 px-4 sm:px-6">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-xs text-white">
                            {((sess.customerName || '?').trim().charAt(0) || '?').toUpperCase()}
                          </div>
                          <span className="font-bold text-white text-sm">
                            {sess.customerName || 'Walk-in Gamer'}
                          </span>
                        </div>
                      </td>

                      {/* Station */}
                      <td className="py-3.5 px-4">
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-slate-950 border border-slate-800 font-mono-code text-emerald-400 font-bold text-[11px]">
                          <Tv className="w-3 h-3 text-slate-500" />
                          <span>{sess.stationName}</span>
                        </span>
                      </td>

                      {/* Phone */}
                      <td className="py-3.5 px-4">
                        <span className="font-mono-code text-slate-400 text-xs">
                          {sess.customerPhone || 'Walk-in'}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4 text-center">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-mono-code text-[10px] font-bold uppercase border ${
                            isActive
                              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                              : sess.status === 'COMPLETED'
                              ? 'bg-blue-500/15 text-blue-300 border-blue-500/30'
                              : sess.status === 'TRANSFERRED'
                              ? 'bg-purple-500/15 text-purple-300 border-purple-500/30'
                              : 'bg-slate-800 text-slate-400 border-slate-700'
                          }`}
                        >
                          {isActive ? (
                            <>
                              <Radio className="w-2.5 h-2.5 text-emerald-400 animate-pulse" />
                              <span>Active</span>
                            </>
                          ) : sess.status === 'COMPLETED' ? (
                            <>
                              <CheckCircle2 className="w-2.5 h-2.5 text-blue-400" />
                              <span>Completed</span>
                            </>
                          ) : (
                            sess.status
                          )}
                        </span>
                      </td>

                      {/* Started At */}
                      <td className="py-3.5 px-4">
                        <span className="text-slate-300 font-mono-code text-xs">
                          {formatSessionTime(sess.startedAt)}
                        </span>
                      </td>

                      {/* Duration */}
                      <td className="py-3.5 px-4 text-center">
                        <span className="font-mono-code text-slate-300 text-xs">
                          {isActive
                            ? `${sess.elapsedMinutes}m / ${sess.durationMinutes || 60}m`
                            : `${sess.elapsedMinutes || 0}m`}
                        </span>
                      </td>

                      {/* Total Cost */}
                      <td className="py-3.5 px-4 text-right">
                        <span className="font-mono-code font-black text-emerald-400 text-sm">
                          ₹{Number(sess.totalCost || 0).toFixed(2)}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
