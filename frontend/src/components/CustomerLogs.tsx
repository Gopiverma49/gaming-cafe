import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Search,
  History,
  Tv,
  Radio,
  CheckCircle2,
  Phone,
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
          <History className="w-5 h-5 text-[#EA580C]" />
          <span className="font-bold text-[#172554] text-base sm:text-lg font-display tracking-wide">
            Session Check-in Logs
          </span>
          <span className="text-[11px] font-mono-code px-2.5 py-0.5 rounded-full bg-[#FFF7ED] border border-[#FED7AA] text-[#C2410C] font-bold">
            {sessionLogs.length} Records
          </span>
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-72">
          <Search className="w-3.5 h-3.5 absolute left-3 top-3 text-[#94A3B8]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search player, station, phone..."
            className="w-full pl-9 pr-3 py-2 bg-[#FFFFFF] border border-[#E2E8F0] rounded-xl text-xs text-[#0F172A] placeholder-[#94A3B8] focus:outline-none focus:border-[#EA580C] transition-colors shadow-xs"
          />
        </div>
      </div>

      {/* Session Check-in Logs Table */}
      <div className="bg-[#FFFFFF] rounded-2xl sm:rounded-3xl border border-[#E2E8F0] overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-[#FFF7ED] text-[#64748B] border-b border-[#E2E8F0] uppercase text-[10px] tracking-wider font-mono-code font-bold">
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
            <tbody className="divide-y divide-[#E2E8F0]">
              {isLoadingSessions && sessionLogs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-[#64748B] font-mono-code">
                    Loading Session Logs...
                  </td>
                </tr>
              ) : filteredSessions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-[#64748B]">
                    No session records found matching your filter.
                  </td>
                </tr>
              ) : (
                filteredSessions.map((sess) => {
                  const isActive = sess.status === 'ACTIVE';

                  return (
                    <tr key={sess.id} className="hover:bg-[#FFF7ED]/40 transition-colors">
                      {/* Player */}
                      <td className="py-3.5 px-4 sm:px-6">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-xl bg-[#FFF7ED] border border-[#FED7AA] flex items-center justify-center font-bold text-xs text-[#EA580C] shrink-0">
                            {((sess.customerName || '?').trim().charAt(0) || '?').toUpperCase()}
                          </div>
                          <div>
                            <span className="font-bold text-[#0F172A] text-sm block">
                              {sess.customerName || 'Walk-in Gamer'}
                            </span>
                            {sess.customerPhone && (
                              <span className="text-[10px] text-[#64748B] font-mono-code sm:hidden block">
                                {sess.customerPhone}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Station */}
                      <td className="py-3.5 px-4">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#EFF6FF] border border-[#BFDBFE] font-mono-code text-[#172554] font-bold text-[11px]">
                          <Tv className="w-3 h-3 text-[#1E3A8A]" />
                          <span>{sess.stationName}</span>
                        </span>
                      </td>

                      {/* Phone */}
                      <td className="py-3.5 px-4">
                        {sess.customerPhone ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-[#FFF7ED] border border-[#FED7AA] font-mono-code text-[#C2410C] font-semibold text-xs">
                            <Phone className="w-3 h-3 text-[#EA580C]" />
                            <span>{sess.customerPhone}</span>
                          </span>
                        ) : (
                          <span className="font-mono-code text-[#94A3B8] text-xs italic">
                            Walk-in
                          </span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4 text-center">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-mono-code text-[10px] font-bold uppercase border ${
                            isActive
                              ? 'bg-[#DCFCE7] text-[#15803D] border-[#BBF7D0]'
                              : sess.status === 'COMPLETED'
                              ? 'bg-[#EFF6FF] text-[#1E3A8A] border-[#BFDBFE]'
                              : sess.status === 'TRANSFERRED'
                              ? 'bg-[#FAF5FF] text-[#7E22CE] border-[#E9D5FF]'
                              : 'bg-[#F1F5F9] text-[#64748B] border-[#E2E8F0]'
                          }`}
                        >
                          {isActive ? (
                            <>
                              <Radio className="w-2.5 h-2.5 text-[#15803D] animate-pulse" />
                              <span>Active</span>
                            </>
                          ) : sess.status === 'COMPLETED' ? (
                            <>
                              <CheckCircle2 className="w-2.5 h-2.5 text-[#1E3A8A]" />
                              <span>Completed</span>
                            </>
                          ) : (
                            sess.status
                          )}
                        </span>
                      </td>

                      {/* Started At */}
                      <td className="py-3.5 px-4">
                        <span className="text-[#64748B] font-mono-code text-xs">
                          {formatSessionTime(sess.startedAt)}
                        </span>
                      </td>

                      {/* Duration */}
                      <td className="py-3.5 px-4 text-center">
                        <span className="font-mono-code text-[#0F172A] text-xs font-semibold">
                          {isActive
                            ? `${sess.elapsedMinutes}m / ${sess.durationMinutes || 60}m`
                            : `${sess.elapsedMinutes || 0}m`}
                        </span>
                      </td>

                      {/* Total Cost */}
                      <td className="py-3.5 px-4 text-right">
                        <span className="font-mono-code font-black text-[#172554] text-sm">
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
