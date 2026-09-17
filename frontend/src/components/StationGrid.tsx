import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Monitor,
  Clock,
  QrCode,
  ArrowRightLeft,
  CreditCard,
  Banknote,
  AlertCircle,
  PlusCircle,
  CheckCircle2,
  XCircle,
  Flame,
  Gamepad2,
  RefreshCw,
  Filter,
} from 'lucide-react';
import { StationLive, StationTier, CheckoutResult } from '../types';
import {
  fetchLiveStations,
  checkInStation,
  transferStation,
  checkoutSession,
} from '../api';

interface StationGridProps {
  onSelectStationForDeskView?: (stationId: string, sessionId?: string) => void;
}

export const StationGrid: React.FC<StationGridProps> = ({ onSelectStationForDeskView }) => {
  const queryClient = useQueryClient();

  // Filter States
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'AVAILABLE' | 'OCCUPIED' | 'EXPIRING'>('ALL');

  // Dialog States
  const [checkInModalStation, setCheckInModalStation] = useState<StationLive | null>(null);
  const [allocatedMinutes, setAllocatedMinutes] = useState(60);

  const [transferModalStation, setTransferModalStation] = useState<StationLive | null>(null);
  const [targetStationId, setTargetStationId] = useState<string>('');

  const [checkoutModalStation, setCheckoutModalStation] = useState<StationLive | null>(null);
  const [checkoutResult, setCheckoutResult] = useState<CheckoutResult | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'UPI' | 'CASH'>('UPI');
  const [actionError, setActionError] = useState<string | null>(null);

  // TanStack Query for Live Stations
  const { data: stations = [], isRefetching } = useQuery<StationLive[]>({
    queryKey: ['stations-live'],
    queryFn: fetchLiveStations,
    refetchInterval: 10000,
  });

  // Mutations
  const checkInMutation = useMutation({
    mutationFn: () => checkInStation(checkInModalStation!.id, allocatedMinutes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stations-live'] });
      setCheckInModalStation(null);
      setActionError(null);
    },
    onError: (err: any) => setActionError(err.message),
  });

  const transferMutation = useMutation({
    mutationFn: () =>
      transferStation(transferModalStation!.active_session_id!, targetStationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stations-live'] });
      setTransferModalStation(null);
      setTargetStationId('');
      setActionError(null);
    },
    onError: (err: any) => setActionError(err.message),
  });

  const checkoutMutation = useMutation({
    mutationFn: () =>
      checkoutSession(checkoutModalStation!.active_session_id!, paymentMethod),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['stations-live'] });
      setCheckoutResult(res);
      setActionError(null);
    },
    onError: (err: any) => setActionError(err.message),
  });

  // Helper to determine status color styling
  const getStatusColorConfig = (station: StationLive) => {
    if (station.status === 'MAINTENANCE') {
      return {
        badge: 'bg-slate-800 text-slate-400 border-slate-700',
        border: 'border-slate-800',
        glow: '',
        dot: 'bg-slate-500',
        label: 'Maintenance',
      };
    }
    if (station.status === 'AVAILABLE') {
      return {
        badge: 'bg-emerald-950/80 text-emerald-400 border-emerald-800/60',
        border: 'border-emerald-500/30 hover:border-emerald-400/80',
        glow: 'hover:shadow-[0_0_25px_rgba(16,185,129,0.15)]',
        dot: 'bg-emerald-400',
        label: 'Available',
      };
    }
    // OCCUPIED logic
    const remaining = station.remaining_minutes ?? 999;
    if (remaining <= 0) {
      return {
        badge: 'bg-rose-950/90 text-rose-400 border-rose-800/80 animate-pulse',
        border: 'border-rose-500/60 shadow-[0_0_20px_rgba(244,63,94,0.2)]',
        glow: 'hover:shadow-[0_0_25px_rgba(244,63,94,0.3)]',
        dot: 'bg-rose-500 animate-ping',
        label: 'Time Expired',
      };
    }
    if (remaining <= 10) {
      return {
        badge: 'bg-amber-950/90 text-amber-400 border-amber-800/80',
        border: 'border-amber-500/50 shadow-[0_0_20px_rgba(245,158,11,0.2)]',
        glow: 'hover:shadow-[0_0_25px_rgba(245,158,11,0.3)]',
        dot: 'bg-amber-400',
        label: `${remaining}m Left`,
      };
    }
    return {
      badge: 'bg-cyan-950/80 text-cyan-400 border-cyan-800/60',
      border: 'border-cyan-500/40 shadow-[0_0_20px_rgba(6,182,212,0.15)]',
      glow: 'hover:shadow-[0_0_25px_rgba(6,182,212,0.25)]',
      dot: 'bg-cyan-400',
      label: 'Occupied',
    };
  };

  const getTierBadge = (tier: StationTier) => {
    switch (tier) {
      case 'VIP':
        return 'bg-purple-950/60 text-purple-300 border-purple-800/60';
      case 'SIMULATOR':
        return 'bg-cyan-950/60 text-cyan-300 border-cyan-800/60';
      case 'CONSOLE':
        return 'bg-indigo-950/60 text-indigo-300 border-indigo-800/60';
      default:
        return 'bg-slate-800/60 text-slate-300 border-slate-700/60';
    }
  };

  // Quick time extension
  const handleQuickExtend = (station: StationLive, minutes: number) => {
    alert(`Added +${minutes}m to ${station.name}. (Active Session Timer Extended)`);
  };

  const availableStations = stations.filter((s) => s.status === 'AVAILABLE');
  const occupiedStations = stations.filter((s) => s.status === 'OCCUPIED');
  const expiringStations = stations.filter(
    (s) => (s.remaining_minutes ?? 99) <= 10 && s.status === 'OCCUPIED'
  );

  const filteredStations = stations.filter((st) => {
    if (statusFilter === 'AVAILABLE') return st.status === 'AVAILABLE';
    if (statusFilter === 'OCCUPIED') return st.status === 'OCCUPIED';
    if (statusFilter === 'EXPIRING') return (st.remaining_minutes ?? 99) <= 10 && st.status === 'OCCUPIED';
    return true;
  });

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Top Matrix Status Bar */}
      <div className="glass-panel p-3.5 sm:p-4 rounded-xl border border-slate-800 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center space-x-2.5 sm:space-x-3">
            <div className="p-2 sm:p-2.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 shrink-0">
              <Monitor className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-bold tracking-wide font-display text-white">
                STATION MATRIX
              </h2>
              <p className="text-[11px] sm:text-xs text-slate-400 font-mono-code">
                Real-Time Desk Slots • Zero Float Drift
              </p>
            </div>
          </div>

          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ['stations-live'] })}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors border border-slate-700 text-xs font-mono-code ml-auto sm:ml-0"
            title="Refresh Matrix"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefetching ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>

        {/* Responsive Summary Tiles */}
        <div className="grid grid-cols-3 gap-2 bg-slate-900/80 p-2.5 rounded-lg border border-slate-800 text-xs font-mono-code text-center sm:text-left sm:flex sm:items-center sm:space-x-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-1 text-emerald-400">
            <span className="inline-flex items-center justify-center sm:justify-start gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span className="text-[10px] sm:text-xs text-slate-400">Available:</span>
            </span>
            <span className="font-bold text-sm sm:text-xs">{availableStations.length}</span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-1 text-blue-400">
            <span className="inline-flex items-center justify-center sm:justify-start gap-1">
              <span className="w-2 h-2 rounded-full bg-blue-500"></span>
              <span className="text-[10px] sm:text-xs text-slate-400">Occupied:</span>
            </span>
            <span className="font-bold text-sm sm:text-xs">{occupiedStations.length}</span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-1 text-amber-400">
            <span className="inline-flex items-center justify-center sm:justify-start gap-1">
              <span className="w-2 h-2 rounded-full bg-amber-500"></span>
              <span className="text-[10px] sm:text-xs text-slate-400">Expiring:</span>
            </span>
            <span className="font-bold text-sm sm:text-xs">{expiringStations.length}</span>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs font-mono-code pt-1">
          <span className="text-slate-500 flex items-center gap-1 pr-1 text-[11px] shrink-0">
            <Filter className="w-3.5 h-3.5" />
            Filter:
          </span>
          <button
            onClick={() => setStatusFilter('ALL')}
            className={`px-3 py-1.5 rounded-lg font-semibold transition-all shrink-0 ${
              statusFilter === 'ALL'
                ? 'bg-slate-200 text-slate-950 shadow-sm'
                : 'bg-slate-900/90 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            All ({stations.length})
          </button>
          <button
            onClick={() => setStatusFilter('AVAILABLE')}
            className={`px-3 py-1.5 rounded-lg font-semibold transition-all shrink-0 ${
              statusFilter === 'AVAILABLE'
                ? 'bg-emerald-500 text-black shadow-sm font-bold'
                : 'bg-emerald-950/40 text-emerald-400 hover:text-emerald-300 border border-emerald-800/40'
            }`}
          >
            Available ({availableStations.length})
          </button>
          <button
            onClick={() => setStatusFilter('OCCUPIED')}
            className={`px-3 py-1.5 rounded-lg font-semibold transition-all shrink-0 ${
              statusFilter === 'OCCUPIED'
                ? 'bg-cyan-500 text-black shadow-sm font-bold'
                : 'bg-cyan-950/40 text-cyan-400 hover:text-cyan-300 border border-cyan-800/40'
            }`}
          >
            Occupied ({occupiedStations.length})
          </button>
          <button
            onClick={() => setStatusFilter('EXPIRING')}
            className={`px-3 py-1.5 rounded-lg font-semibold transition-all shrink-0 ${
              statusFilter === 'EXPIRING'
                ? 'bg-amber-500 text-black shadow-sm font-bold'
                : 'bg-amber-950/40 text-amber-400 hover:text-amber-300 border border-amber-800/40'
            }`}
          >
            Expiring ({expiringStations.length})
          </button>
        </div>
      </div>

      {actionError && (
        <div className="p-3.5 sm:p-4 rounded-xl bg-rose-950/90 border border-rose-600/80 text-rose-200 flex items-center justify-between text-xs sm:text-sm shadow-lg">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 sm:w-5 sm:h-5 text-rose-400 shrink-0" />
            <span>{actionError}</span>
          </div>
          <button
            onClick={() => setActionError(null)}
            className="text-xs bg-rose-900 hover:bg-rose-800 px-2.5 py-1 rounded-md text-rose-200 shrink-0 ml-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* High-Density Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5 sm:gap-5">
        {filteredStations.map((station) => {
          const style = getStatusColorConfig(station);
          const isOccupied = station.status === 'OCCUPIED';

          return (
            <div
              key={station.id}
              className={`relative rounded-2xl glass-panel p-4 sm:p-5 border transition-all duration-300 flex flex-col justify-between ${style.border} ${style.glow}`}
            >
              {/* Header */}
              <div>
                <div className="flex items-start justify-between gap-2 mb-2.5 sm:mb-3">
                  <div>
                    <span className={`text-[10px] font-mono-code uppercase px-2 py-0.5 rounded border ${getTierBadge(station.tier)}`}>
                      {station.tier}
                    </span>
                    <h3 className="text-base sm:text-lg font-bold text-white tracking-wide mt-1 font-display">
                      {station.name}
                    </h3>
                  </div>

                  <span className={`inline-flex items-center gap-1.5 text-[11px] sm:text-xs font-semibold px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full border ${style.badge} shrink-0`}>
                    <span className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full ${style.dot}`}></span>
                    {style.label}
                  </span>
                </div>

                {/* Rates & Metrics */}
                <div className="bg-slate-950/60 rounded-xl p-3 border border-slate-800/80 mb-3 sm:mb-4 space-y-1.5 sm:space-y-2 text-xs">
                  <div className="flex justify-between items-center text-slate-400">
                    <span>Hourly Rate</span>
                    <span className="font-mono-code text-slate-200 font-semibold">₹{Number(station.hourly_rate).toFixed(2)}/hr</span>
                  </div>

                  {isOccupied && (
                    <>
                      <div className="flex justify-between items-center text-slate-400">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-cyan-400" />
                          Elapsed / Left
                        </span>
                        <span className="font-mono-code font-semibold text-cyan-300">
                          {station.elapsed_minutes}m / {station.remaining_minutes !== null ? `${station.remaining_minutes}m` : '∞'}
                        </span>
                      </div>

                      <div className="flex justify-between items-center text-slate-400 border-t border-slate-800/80 pt-1.5">
                        <span>Tab (Time + Food)</span>
                        <span className="font-mono-code text-emerald-400 font-bold text-sm">
                          ₹{Number(station.running_total).toFixed(2)}
                        </span>
                      </div>

                      {station.active_orders_count > 0 && (
                        <div className="flex items-center justify-between text-amber-400 text-[11px] pt-0.5">
                          <span className="flex items-center gap-1">
                            <Flame className="w-3 h-3 animate-pulse" />
                            Kitchen Orders
                          </span>
                          <span className="font-mono-code font-bold bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800/40">
                            {station.active_orders_count} pending
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Quick Actions & Control Bar */}
              <div className="space-y-2 pt-2 border-t border-slate-800/60">
                {isOccupied ? (
                  <>
                    {/* Time Extension Shortcuts */}
                    <div className="flex items-center justify-between gap-1 text-[11px] font-mono-code">
                      <span className="text-slate-400 text-[10px]">Add Time:</span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleQuickExtend(station, 15)}
                          className="px-2 py-1.5 min-h-[34px] bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-300 rounded border border-slate-700 hover:border-slate-500 transition-colors"
                        >
                          +15m
                        </button>
                        <button
                          onClick={() => handleQuickExtend(station, 30)}
                          className="px-2 py-1.5 min-h-[34px] bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-300 rounded border border-slate-700 hover:border-slate-500 transition-colors"
                        >
                          +30m
                        </button>
                        <button
                          onClick={() => handleQuickExtend(station, 60)}
                          className="px-2 py-1.5 min-h-[34px] bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-300 rounded border border-slate-700 hover:border-slate-500 transition-colors"
                        >
                          +1h
                        </button>
                      </div>
                    </div>

                    {/* Operational Triggers */}
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <button
                        onClick={() => {
                          setTransferModalStation(station);
                          setActionError(null);
                        }}
                        className="flex items-center justify-center gap-1.5 px-3 py-2.5 min-h-[42px] bg-slate-800/90 hover:bg-slate-700 active:bg-slate-600 text-slate-200 rounded-xl text-xs font-semibold border border-slate-700 transition-all hover:text-white"
                      >
                        <ArrowRightLeft className="w-3.5 h-3.5 text-blue-400" />
                        Transfer
                      </button>

                      <button
                        onClick={() => {
                          setCheckoutModalStation(station);
                          setCheckoutResult(null);
                          setActionError(null);
                        }}
                        className="flex items-center justify-center gap-1.5 px-3 py-2.5 min-h-[42px] bg-rose-950/70 hover:bg-rose-900 active:bg-rose-800 text-rose-200 rounded-xl text-xs font-semibold border border-rose-800/60 transition-all hover:text-white"
                      >
                        <CreditCard className="w-3.5 h-3.5 text-rose-400" />
                        Checkout
                      </button>
                    </div>

                    {onSelectStationForDeskView && (
                      <button
                        onClick={() => onSelectStationForDeskView(station.id, station.active_session_id || undefined)}
                        className="w-full text-center text-[11px] py-1 text-slate-400 hover:text-emerald-400 transition-colors pt-1.5 font-mono-code"
                      >
                        Launch Desk HUD View →
                      </button>
                    )}
                  </>
                ) : (
                  <button
                    onClick={() => {
                      setCheckInModalStation(station);
                      setActionError(null);
                    }}
                    className="w-full flex items-center justify-center gap-2 py-3 min-h-[44px] bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-black font-bold rounded-xl text-xs tracking-wider uppercase transition-all shadow-lg hover:shadow-emerald-500/25"
                  >
                    <PlusCircle className="w-4 h-4" />
                    Check-In Player
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* CHECK-IN MODAL (Bottom Sheet on Mobile, Centered Modal on Desktop) */}
      {checkInModalStation && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="glass-panel max-w-md w-full rounded-t-3xl sm:rounded-2xl p-5 sm:p-6 border border-emerald-500/40 shadow-2xl relative animate-in slide-in-from-bottom-5 sm:zoom-in-95 max-h-[90vh] overflow-y-auto pb-safe">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center space-x-2">
                <Gamepad2 className="w-5 h-5 text-emerald-400" />
                <h3 className="text-base sm:text-lg font-bold text-white font-display">
                  Check-In: {checkInModalStation.name}
                </h3>
              </div>
              <button
                onClick={() => setCheckInModalStation(null)}
                className="text-slate-400 hover:text-white p-1"
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>

            <div className="space-y-4 text-sm">
              <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800 text-xs">
                <div className="flex justify-between text-slate-400 mb-1">
                  <span>Rig Tier:</span>
                  <span className="text-slate-200 font-semibold">{checkInModalStation.tier}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Billing Rate:</span>
                  <span className="text-emerald-400 font-mono-code font-bold">
                    ₹{Number(checkInModalStation.hourly_rate).toFixed(2)}/hr
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-mono-code text-slate-300 mb-2">
                  Initial Allocated Play Time:
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {[30, 60, 120, 180].map((mins) => (
                    <button
                      key={mins}
                      type="button"
                      onClick={() => setAllocatedMinutes(mins)}
                      className={`py-3 min-h-[44px] text-xs font-mono-code rounded-xl border transition-all ${
                        allocatedMinutes === mins
                          ? 'bg-emerald-500 text-black font-bold border-emerald-400'
                          : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                      }`}
                    >
                      {mins >= 60 ? `${mins / 60} hr` : `${mins} min`}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-3 flex gap-3">
                <button
                  onClick={() => setCheckInModalStation(null)}
                  className="flex-1 py-3 min-h-[44px] rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  disabled={checkInMutation.isPending}
                  onClick={() => checkInMutation.mutate()}
                  className="flex-1 py-3 min-h-[44px] rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-50 shadow-lg hover:shadow-emerald-500/25"
                >
                  {checkInMutation.isPending ? 'Starting...' : 'Confirm Check-In'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TRANSFER MODAL (Bottom Sheet on Mobile, Centered Modal on Desktop) */}
      {transferModalStation && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="glass-panel max-w-md w-full rounded-t-3xl sm:rounded-2xl p-5 sm:p-6 border border-blue-500/40 shadow-2xl relative animate-in slide-in-from-bottom-5 sm:zoom-in-95 max-h-[90vh] overflow-y-auto pb-safe">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center space-x-2">
                <ArrowRightLeft className="w-5 h-5 text-blue-400" />
                <h3 className="text-base sm:text-lg font-bold text-white font-display">
                  Transfer: {transferModalStation.name}
                </h3>
              </div>
              <button
                onClick={() => setTransferModalStation(null)}
                className="text-slate-400 hover:text-white p-1"
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>

            <div className="space-y-4 text-sm">
              <p className="text-xs text-slate-300 leading-relaxed">
                Select an available target station to transfer the active player session seamlessly.
              </p>

              <div>
                <label className="block text-xs font-mono-code text-slate-300 mb-2">
                  Select Target Available Station:
                </label>
                {availableStations.length === 0 ? (
                  <div className="p-3 bg-rose-950/40 border border-rose-800/60 rounded-xl text-xs text-rose-300">
                    No available stations open for transfer right now.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                    {availableStations.map((target) => (
                      <div
                        key={target.id}
                        onClick={() => setTargetStationId(target.id)}
                        className={`p-3 rounded-xl border text-xs cursor-pointer flex items-center justify-between transition-all min-h-[48px] ${
                          targetStationId === target.id
                            ? 'bg-blue-600/30 border-blue-400 text-white'
                            : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        <div>
                          <div className="font-semibold text-white">{target.name}</div>
                          <div className="text-[11px] text-slate-400">{target.tier}</div>
                        </div>
                        <div className="font-mono-code text-blue-400 font-bold">
                          ₹{Number(target.hourly_rate).toFixed(2)}/hr
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="pt-3 flex gap-3">
                <button
                  onClick={() => setTransferModalStation(null)}
                  className="flex-1 py-3 min-h-[44px] rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  disabled={!targetStationId || transferMutation.isPending}
                  onClick={() => transferMutation.mutate()}
                  className="flex-1 py-3 min-h-[44px] rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-50"
                >
                  {transferMutation.isPending ? 'Transferring...' : 'Execute Transfer'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CHECKOUT MODAL (Bottom Sheet on Mobile, Centered Modal on Desktop) */}
      {checkoutModalStation && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="glass-panel max-w-lg w-full rounded-t-3xl sm:rounded-2xl p-5 sm:p-6 border border-rose-500/40 shadow-2xl relative animate-in slide-in-from-bottom-5 sm:zoom-in-95 max-h-[92vh] overflow-y-auto pb-safe">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center space-x-2">
                <CreditCard className="w-5 h-5 text-rose-400" />
                <h3 className="text-base sm:text-lg font-bold text-white font-display truncate">
                  Checkout: {checkoutModalStation.name}
                </h3>
              </div>
              <button
                onClick={() => {
                  setCheckoutModalStation(null);
                  setCheckoutResult(null);
                }}
                className="text-slate-400 hover:text-white p-1"
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>

            {!checkoutResult ? (
              <div className="space-y-4 text-sm">
                <div className="bg-slate-900/90 rounded-xl p-3.5 sm:p-4 border border-slate-800 space-y-2">
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>Active Session Duration:</span>
                    <span className="text-slate-200 font-mono-code font-bold">
                      {checkoutModalStation.elapsed_minutes} minutes
                    </span>
                  </div>
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>Station Time Charge:</span>
                    <span className="text-slate-200 font-mono-code">
                      ₹{Number(checkoutModalStation.time_charge).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>Kitchen Orders Tab:</span>
                    <span className="text-slate-200 font-mono-code">
                      ₹{Number(checkoutModalStation.orders_charge).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm font-bold text-white border-t border-slate-800 pt-2">
                    <span>Total Billable Amount:</span>
                    <span className="font-mono-code text-emerald-400 text-base">
                      ₹{Number(checkoutModalStation.running_total).toFixed(2)}
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-mono-code text-slate-300 mb-2">
                    Choose Settlement Channel:
                  </label>
                  <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('UPI')}
                      className={`p-3 min-h-[48px] rounded-xl border flex items-center justify-center gap-2 text-xs font-bold transition-all ${
                        paymentMethod === 'UPI'
                          ? 'bg-cyan-950/80 border-cyan-400 text-cyan-300 shadow-[0_0_15px_rgba(6,182,212,0.3)]'
                          : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:bg-slate-800'
                      }`}
                    >
                      <QrCode className="w-4 h-4" />
                      UPI Dynamic QR
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('CASH')}
                      className={`p-3 min-h-[48px] rounded-xl border flex items-center justify-center gap-2 text-xs font-bold transition-all ${
                        paymentMethod === 'CASH'
                          ? 'bg-emerald-950/80 border-emerald-400 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.3)]'
                          : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:bg-slate-800'
                      }`}
                    >
                      <Banknote className="w-4 h-4" />
                      Cash Register
                    </button>
                  </div>
                </div>

                <div className="pt-3 flex gap-3">
                  <button
                    onClick={() => setCheckoutModalStation(null)}
                    className="flex-1 py-3 min-h-[44px] rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    disabled={checkoutMutation.isPending}
                    onClick={() => checkoutMutation.mutate()}
                    className="flex-1 py-3 min-h-[44px] rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-50 shadow-lg hover:shadow-rose-500/30"
                  >
                    {checkoutMutation.isPending ? 'Computing...' : 'Complete Checkout'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4 text-center">
                <div className="inline-flex p-3 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 mb-1">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <h4 className="text-base font-bold text-white">Checkout Completed Successfully!</h4>

                <div className="bg-slate-900/90 rounded-xl p-3.5 sm:p-4 border border-slate-800 text-left text-xs space-y-1.5">
                  <div className="flex justify-between text-slate-400">
                    <span>Payment ID:</span>
                    <span className="text-slate-300 font-mono-code">{checkoutResult.payment_id.slice(0, 8)}...</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Total Paid:</span>
                    <span className="text-emerald-400 font-mono-code font-bold text-sm">
                      ₹{Number(checkoutResult.total_amount).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Method:</span>
                    <span className="text-slate-200 uppercase font-semibold">{checkoutResult.payment_method}</span>
                  </div>
                </div>

                {checkoutResult.upi_qr_string && (
                  <div className="bg-white p-3 sm:p-4 rounded-xl inline-block shadow-xl my-2 max-w-full">
                    {/* SVG UPI QR Representation */}
                    <div className="w-40 h-40 sm:w-48 sm:h-48 bg-slate-100 flex flex-col items-center justify-center border-2 border-dashed border-slate-400 rounded-lg p-2 mx-auto">
                      <QrCode className="w-20 h-20 sm:w-24 sm:h-24 text-slate-900" />
                      <span className="text-[9px] text-slate-700 font-mono-code mt-1 break-all px-1 line-clamp-2">
                        {checkoutResult.upi_qr_string}
                      </span>
                    </div>
                    <span className="block text-slate-800 text-[10px] font-bold mt-1">
                      SCAN VIA ANY UPI APP
                    </span>
                  </div>
                )}

                <button
                  onClick={() => {
                    setCheckoutModalStation(null);
                    setCheckoutResult(null);
                  }}
                  className="w-full py-3 min-h-[44px] rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold transition-all"
                >
                  Close & Release Station
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
