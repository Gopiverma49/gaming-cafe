import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Search,
  Phone,
  Clock,
  Trophy,
} from 'lucide-react';
import { fetchAdminCustomers } from '../api';
import { CustomerRecord } from '../types';

export const CustomerLogs: React.FC = () => {
  const { data: customerLogs = [] } = useQuery<CustomerRecord[]>({
    queryKey: ['admin-customers'],
    queryFn: fetchAdminCustomers,
    refetchInterval: 8000,
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'visits' | 'recent' | 'spent'>('visits');

  // Filter & Sort
  const filteredLogs = useMemo(() => {
    return customerLogs
      .filter((c) => {
        const q = searchQuery.toLowerCase();
        return (
          c.name.toLowerCase().includes(q) ||
          c.phone.includes(q) ||
          (c.notes && c.notes.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => {
        if (sortBy === 'visits') return b.visit_count - a.visit_count;
        if (sortBy === 'spent') return b.total_spent - a.total_spent;
        return 0; // default order
      });
  }, [customerLogs, searchQuery, sortBy]);

  return (
    <div className="space-y-4">
      {/* 1. Search & Sort Controls */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, phone..."
            className="w-full pl-8 pr-3 py-2 bg-slate-900/90 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-cyan-500"
          />
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <span className="text-xs text-slate-400">Sort by:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
          >
            <option value="visits">Most Visits</option>
            <option value="spent">Highest Spend</option>
            <option value="recent">Recently Added</option>
          </select>
        </div>
      </div>

      {/* 2. Customer Directory Table */}
      <div className="bg-slate-900/85 backdrop-blur-xl rounded-3xl border border-slate-800 overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800 uppercase text-[10px] tracking-wider font-mono-code">
              <tr>
                <th className="py-3.5 px-4 sm:px-6">Customer Name</th>
                <th className="py-3.5 px-4">Mobile Number</th>
                <th className="py-3.5 px-4 text-center">Number of Visits</th>
                <th className="py-3.5 px-4">Last Visit</th>
                <th className="py-3.5 px-4 text-right">Total Spent</th>
                <th className="py-3.5 px-4 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-500">
                    No customer logs found matching your search.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((cust) => (
                  <tr
                    key={cust.id}
                    className="hover:bg-slate-800/40 transition-colors"
                  >
                    {/* Name */}
                    <td className="py-3.5 px-4 sm:px-6">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border border-cyan-500/30 flex items-center justify-center font-bold text-cyan-300">
                          {cust.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <span className="font-bold text-white block text-sm">
                            {cust.name}
                          </span>
                          {cust.notes && (
                            <span className="text-[10px] text-slate-400">
                              {cust.notes}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Phone */}
                    <td className="py-3.5 px-4">
                      <span className="font-mono-code text-slate-300 flex items-center gap-1.5">
                        <Phone className="w-3 h-3 text-slate-500" />
                        <span>{cust.phone}</span>
                      </span>
                    </td>

                    {/* Visits */}
                    <td className="py-3.5 px-4 text-center">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-mono-code text-[11px] font-bold ${
                          cust.visit_count >= 10
                            ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                            : cust.visit_count >= 5
                            ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30'
                            : 'bg-slate-800 text-slate-300'
                        }`}
                      >
                        {cust.visit_count >= 10 && <Trophy className="w-3 h-3 text-amber-400" />}
                        <span>{cust.visit_count} Visit{cust.visit_count === 1 ? '' : 's'}</span>
                      </span>
                    </td>

                    {/* Last Visit */}
                    <td className="py-3.5 px-4">
                      <span className="text-slate-300 text-xs flex items-center gap-1.5">
                        <Clock className="w-3 h-3 text-slate-500" />
                        <span>{cust.last_visit}</span>
                      </span>
                    </td>

                    {/* Total Spent */}
                    <td className="py-3.5 px-4 text-right">
                      <span className="font-mono-code text-emerald-400 font-bold text-sm">
                        ₹{Number(cust.total_spent).toFixed(2)}
                      </span>
                    </td>

                    {/* Gamer Status */}
                    <td className="py-3.5 px-4 text-center">
                      <span
                        className={`inline-block px-2.5 py-1 rounded-lg text-[10px] font-bold ${
                          cust.notes?.includes('Registered')
                            ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                            : 'bg-slate-800 text-slate-400 border border-slate-700'
                        }`}
                      >
                        {cust.notes || 'Gamer'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
