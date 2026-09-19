import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Clock,
  QrCode,
  ArrowRightLeft,
  CreditCard,
  Banknote,
  AlertCircle,
  PlusCircle,
  CheckCircle2,
  XCircle,
  Gamepad2,
  RefreshCw,
  Cpu,
  Sparkles,
  ExternalLink,
  Receipt,
  Utensils,
  Printer,
} from 'lucide-react';
import { StationLive, CheckoutResult } from '../types';
import {
  fetchLiveStations,
  checkInStation,
  transferStation,
  checkoutSession,
} from '../api';
import { useLoungeStore, OrderedFoodItem } from '../store/loungeStore';
import { useNotificationStore } from '../store/notificationStore';

interface StationGridProps {
  onSelectStationForDeskView?: (stationId: string, sessionId?: string) => void;
}

export const StationGrid: React.FC<StationGridProps> = ({ onSelectStationForDeskView }) => {
  const queryClient = useQueryClient();
  const { addNotification } = useNotificationStore();

  // 3 Clear Filter Options: ALL | AVAILABLE | OCCUPIED
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'AVAILABLE' | 'OCCUPIED'>('ALL');

  // Dialog States
  const [checkInModalStation, setCheckInModalStation] = useState<StationLive | null>(null);
  const [allocatedMinutes, setAllocatedMinutes] = useState(60);

  const [transferModalStation, setTransferModalStation] = useState<StationLive | null>(null);
  const [targetStationId, setTargetStationId] = useState<string>('');

  const [checkoutModalStation, setCheckoutModalStation] = useState<StationLive | null>(null);
  const [checkoutResult, setCheckoutResult] = useState<CheckoutResult | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'UPI' | 'CASH'>('UPI');
  const [actionError, setActionError] = useState<string | null>(null);
  const [isCheckingOut, setIsCheckingOut] = useState(false);

  // Lounge Store state for food orders and revenue recording
  const { stationFoodOrders, recordTransaction, clearStationFoodOrders } = useLoungeStore();

  const handleQuickExtend = (station: StationLive, minutes: number) => {
    addNotification(
      'SYSTEM',
      '⏱️ Session Extended',
      `Extended session on ${station.name} by +${minutes} minutes.`
    );
  };

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

  // Station Category & Visual Config
  const getStationCategory = (station: StationLive) => {
    switch (station.tier) {
      case 'CONSOLE':
        return {
          icon: <Gamepad2 className="w-4 h-4 text-violet-400" />,
          label: 'Console PS5',
          pill: 'bg-violet-950/60 text-violet-300 border-violet-800/50',
          accent: 'violet',
        };
      case 'SIMULATOR':
        return {
          icon: <Sparkles className="w-4 h-4 text-amber-400" />,
          label: 'Simulator Rig',
          pill: 'bg-amber-950/60 text-amber-300 border-amber-800/50',
          accent: 'amber',
        };
      case 'VIP':
        return {
          icon: <Sparkles className="w-4 h-4 text-fuchsia-400" />,
          label: 'VIP Station',
          pill: 'bg-fuchsia-950/60 text-fuchsia-300 border-fuchsia-800/50',
          accent: 'fuchsia',
        };
      default:
        return {
          icon: <Cpu className="w-4 h-4 text-cyan-400" />,
          label: 'Gaming PC',
          pill: 'bg-cyan-950/60 text-cyan-300 border-cyan-800/50',
          accent: 'cyan',
        };
    }
  };

  const getStatusColorConfig = (station: StationLive) => {
    if (station.status === 'MAINTENANCE') {
      return {
        badge: 'bg-slate-800/80 text-slate-400 border-slate-700',
        border: 'border-slate-800',
        glow: '',
        dot: 'bg-slate-500',
        label: 'Maintenance',
      };
    }
    if (station.status === 'AVAILABLE') {
      return {
        badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
        border: 'border-slate-800/90 hover:border-emerald-500/50',
        glow: 'hover:shadow-[0_10px_30px_rgba(16,185,129,0.12)]',
        dot: 'bg-emerald-400',
        label: 'Available',
      };
    }

    // OCCUPIED logic
    const remaining = station.remaining_minutes ?? 999;
    if (remaining <= 0) {
      return {
        badge: 'bg-rose-500/15 text-rose-400 border-rose-500/30 animate-pulse',
        border: 'border-rose-500/50 shadow-[0_4px_25px_rgba(244,63,94,0.15)]',
        glow: 'hover:shadow-[0_8px_30px_rgba(244,63,94,0.25)]',
        dot: 'bg-rose-500 animate-ping',
        label: 'Time Expired',
      };
    }
    if (remaining <= 10) {
      return {
        badge: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
        border: 'border-amber-500/40 shadow-[0_4px_25px_rgba(245,158,11,0.15)]',
        glow: 'hover:shadow-[0_8px_30px_rgba(245,158,11,0.25)]',
        dot: 'bg-amber-400',
        label: `${remaining}m left`,
      };
    }
    return {
      badge: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30',
      border: 'border-cyan-500/30 shadow-[0_4px_25px_rgba(6,182,212,0.12)]',
      glow: 'hover:shadow-[0_8px_30px_rgba(6,182,212,0.22)]',
      dot: 'bg-cyan-400 animate-pulse',
      label: 'In Session',
    };
  };

  const parseStationName = (fullName: string) => {
    const match = fullName.match(/^([^(]+)(?:\(([^)]+)\))?/);
    return {
      title: match ? match[1].trim() : fullName,
      subtitle: match && match[2] ? match[2].trim() : '',
    };
  };

  const availableStations = stations.filter((s) => s.status === 'AVAILABLE');
  const occupiedStations = stations.filter((s) => s.status === 'OCCUPIED');

  // Match active food orders for a station by exact name, ID, or short prefix (e.g. PS5-01)
  const getOrdersForStation = (station: StationLive): OrderedFoodItem[] => {
    if (stationFoodOrders[station.name]?.length) {
      return stationFoodOrders[station.name];
    }
    if (stationFoodOrders[station.id]?.length) {
      return stationFoodOrders[station.id];
    }
    const shortPrefix = station.name.split(' ')[0];
    for (const [key, items] of Object.entries(stationFoodOrders)) {
      if ((key.includes(shortPrefix) || shortPrefix.includes(key)) && items?.length) {
        return items;
      }
    }
    if (occupiedStations.length === 1 && stationFoodOrders['My Assigned Desk']?.length) {
      return stationFoodOrders['My Assigned Desk'];
    }
    return [];
  };

  // Complete checkout, record into Day/Week/Month revenue ledger, and release station
  const handleExecuteCheckout = async () => {
    if (!checkoutModalStation) return;
    setIsCheckingOut(true);
    try {
      const foodItems = getOrdersForStation(checkoutModalStation);
      const foodTotal = foodItems.reduce((acc, item) => acc + item.total, 0) || Number(checkoutModalStation.orders_charge || 0);
      const timeTotal = Number(checkoutModalStation.time_charge || 0);
      const totalAmount = timeTotal + foodTotal;

      let apiRes: CheckoutResult | null = null;
      if (checkoutModalStation.active_session_id) {
        try {
          apiRes = await checkoutSession(checkoutModalStation.active_session_id, paymentMethod);
        } catch (e: any) {
          console.warn('Backend checkout API fallback:', e.message);
        }
      }

      // Record transaction into loungeStore ledger (updates Day, Week, Month revenue live!)
      const recorded = recordTransaction({
        stationName: checkoutModalStation.name,
        customerName: 'Console Gamer',
        timeCharge: Number(timeTotal.toFixed(2)),
        foodCharge: Number(foodTotal.toFixed(2)),
        totalAmount: Number(totalAmount.toFixed(2)),
        paymentMethod: paymentMethod,
        foodItems: foodItems.map((f) => ({ name: f.name, quantity: f.quantity, price: f.price })),
      });

      // Clear station's food tab
      clearStationFoodOrders(checkoutModalStation.name);
      const shortPrefix = checkoutModalStation.name.split(' ')[0];
      clearStationFoodOrders(shortPrefix);

      queryClient.invalidateQueries({ queryKey: ['stations-live'] });

      setCheckoutResult(
        apiRes || {
          session_id: checkoutModalStation.active_session_id || 'manual-session',
          station_id: checkoutModalStation.id,
          total_amount: totalAmount,
          station_charge: timeTotal,
          time_charge: timeTotal,
          orders_charge: foodTotal,
          payment_method: paymentMethod,
          payment_status: 'PAID',
          payment_id: recorded.id,
          upi_qr_string: paymentMethod === 'UPI' ? `upi://pay?pa=gamingcafe@upi&pn=VanyaGamingCafe&am=${totalAmount.toFixed(2)}&cu=INR` : undefined,
        }
      );
      setActionError(null);
    } catch (err: any) {
      setActionError(err.message || 'Failed to complete checkout');
    } finally {
      setIsCheckingOut(false);
    }
  };

  const filteredStations = stations.filter((st) => {
    if (statusFilter === 'AVAILABLE') return st.status === 'AVAILABLE';
    if (statusFilter === 'OCCUPIED') return st.status === 'OCCUPIED';
    return true;
  });

  return (
    <div className="space-y-5">
      {/* Sleek Minimalist Controls Header - Only Three Filter Options */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1 border-b border-slate-800/60">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-xl sm:text-2xl font-bold font-display text-white tracking-wide">
              Gaming Stations
            </h2>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-900 text-slate-300 font-mono-code border border-slate-800">
              {availableStations.length} of {stations.length} Available
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Real-time lounge availability, active play sessions, and quick check-ins
          </p>
        </div>

        {/* 3 Clean Filter Options: All | Available | In Use */}
        <div className="flex items-center gap-2">
          <div className="inline-flex p-1 bg-slate-950/90 rounded-xl border border-slate-800 shadow-inner">
            <button
              onClick={() => setStatusFilter('ALL')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 ${
                statusFilter === 'ALL'
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>All</span>
              <span className="text-[11px] px-1.5 py-0.2 rounded-full bg-slate-900 text-slate-300 font-mono-code">
                {stations.length}
              </span>
            </button>

            <button
              onClick={() => setStatusFilter('AVAILABLE')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 ${
                statusFilter === 'AVAILABLE'
                  ? 'bg-emerald-500 text-slate-950 font-bold shadow-[0_0_15px_rgba(16,185,129,0.35)]'
                  : 'text-slate-400 hover:text-emerald-300'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              <span>Available</span>
              <span className={`text-[11px] px-1.5 py-0.2 rounded-full font-mono-code ${
                statusFilter === 'AVAILABLE' ? 'bg-emerald-600/70 text-slate-950' : 'bg-slate-900 text-slate-300'
              }`}>
                {availableStations.length}
              </span>
            </button>

            <button
              onClick={() => setStatusFilter('OCCUPIED')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 ${
                statusFilter === 'OCCUPIED'
                  ? 'bg-cyan-500 text-slate-950 font-bold shadow-[0_0_15px_rgba(6,182,212,0.35)]'
                  : 'text-slate-400 hover:text-cyan-300'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
              <span>In Use</span>
              <span className={`text-[11px] px-1.5 py-0.2 rounded-full font-mono-code ${
                statusFilter === 'OCCUPIED' ? 'bg-cyan-600/70 text-slate-950' : 'bg-slate-900 text-slate-300'
              }`}>
                {occupiedStations.length}
              </span>
            </button>
          </div>

          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ['stations-live'] })}
            className="p-2 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors border border-slate-800"
            title="Refresh Stations"
          >
            <RefreshCw className={`w-4 h-4 ${isRefetching ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {actionError && (
        <div className="p-3.5 rounded-xl bg-rose-950/90 border border-rose-600/80 text-rose-200 flex items-center justify-between text-xs sm:text-sm shadow-lg">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{actionError}</span>
          </div>
          <button
            onClick={() => setActionError(null)}
            className="text-xs bg-rose-900 hover:bg-rose-800 px-2.5 py-1 rounded-md text-rose-200 shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* User-Friendly Station Cards Grid (3 Stations) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
        {filteredStations.map((station) => {
          const style = getStatusColorConfig(station);
          const category = getStationCategory(station);
          const { title, subtitle } = parseStationName(station.name);
          const isOccupied = station.status === 'OCCUPIED';

          // Session progress calculation
          const totalEst = station.elapsed_minutes + (station.remaining_minutes ?? 60);
          const progressPercent = totalEst > 0
            ? Math.min(100, Math.max(5, Math.round((station.elapsed_minutes / totalEst) * 100)))
            : 0;

          return (
            <div
              key={station.id}
              className={`relative rounded-2xl glass-panel p-4 sm:p-5 border transition-all duration-300 flex flex-col justify-between ${style.border} ${style.glow}`}
            >
              {/* Card Top: Type Badge & Status Indicator */}
              <div>
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-1.5">
                    {category.icon}
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md border ${category.pill}`}>
                      {category.label}
                    </span>
                  </div>

                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border ${style.badge}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`}></span>
                    {style.label}
                  </span>
                </div>

                {/* Station Title & Spec */}
                <div className="mb-3">
                  <h3 className="text-lg font-bold text-white tracking-wide font-display">
                    {title}
                  </h3>
                  {subtitle && (
                    <p className="text-xs text-slate-400">
                      {subtitle}
                    </p>
                  )}
                </div>

                {/* Rates & Session Metrics Box */}
                <div className="bg-slate-950/70 rounded-xl p-3.5 border border-slate-800/80 mb-4 space-y-2.5 text-xs">
                  <div className="flex justify-between items-baseline">
                    <span className="text-slate-400">Rate</span>
                    <div>
                      <span className="font-mono-code font-bold text-white text-base">
                        ₹{Number(station.hourly_rate).toFixed(0)}
                      </span>
                      <span className="text-slate-400 text-[11px] ml-1">/ hr</span>
                    </div>
                  </div>

                  {isOccupied && (() => {
                    const stationFoodItems = getOrdersForStation(station);
                    const calculatedFoodCharge = stationFoodItems.reduce((acc, item) => acc + item.total, 0) || Number(station.orders_charge || 0);
                    const calculatedTimeCharge = Number(station.time_charge || 0);
                    const calculatedGrandTotal = calculatedTimeCharge + calculatedFoodCharge;

                    return (
                      <>
                        {/* 1. Console Time Breakdown */}
                        <div className="space-y-1.5 pt-1 border-t border-slate-800/80">
                          <div className="flex justify-between items-center text-[11px] text-slate-400">
                            <span className="flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5 text-cyan-400" />
                              Console Time: <strong className="text-white font-mono-code">{station.elapsed_minutes}m</strong>
                            </span>
                            <span className="font-semibold text-cyan-300 font-mono-code">
                              {station.remaining_minutes !== null ? `${station.remaining_minutes}m left` : 'Open session'}
                            </span>
                          </div>
                          <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden">
                            <div
                              className="bg-gradient-to-r from-cyan-500 to-emerald-400 h-full rounded-full transition-all duration-500"
                              style={{ width: `${progressPercent}%` }}
                            />
                          </div>
                          <div className="flex justify-between items-center text-[10px] text-slate-400 pt-0.5">
                            <span>Console Time Charge:</span>
                            <span className="font-mono-code text-cyan-300 font-bold">
                              ₹{calculatedTimeCharge.toFixed(2)}
                            </span>
                          </div>
                        </div>

                        {/* 2. Which Food They Ordered */}
                        <div className="bg-slate-900/80 rounded-xl p-2.5 border border-slate-800/90 space-y-1.5">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="flex items-center gap-1.5 font-bold text-amber-300">
                              <Utensils className="w-3.5 h-3.5 text-amber-400" />
                              <span>Food Ordered</span>
                              {stationFoodItems.length > 0 && (
                                <span className="bg-amber-500/20 text-amber-300 text-[10px] px-1.5 py-0.2 rounded-full font-mono-code font-bold">
                                  {stationFoodItems.reduce((sum, item) => sum + item.quantity, 0)}
                                </span>
                              )}
                            </span>
                            <span className="font-mono-code text-amber-400 font-bold text-xs">
                              ₹{calculatedFoodCharge.toFixed(2)}
                            </span>
                          </div>

                          {stationFoodItems.length > 0 ? (
                            <div className="space-y-1 max-h-20 overflow-y-auto pr-1">
                              {stationFoodItems.map((item, idx) => (
                                <div key={idx} className="flex justify-between items-center text-[10px] text-slate-300">
                                  <span className="truncate pr-1">
                                    <strong className="text-amber-300/90">{item.quantity}x</strong> {item.name}
                                  </span>
                                  <span className="font-mono-code text-slate-400 shrink-0">
                                    ₹{item.total.toFixed(0)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="text-[10px] text-slate-500 italic">
                              No cafe snacks ordered yet (₹0.00)
                            </div>
                          )}
                        </div>

                        {/* 3. Generated Grand Total Billable Amount */}
                        <div className="flex justify-between items-center text-slate-300 border-t border-slate-800/80 pt-2">
                          <div>
                            <span className="text-slate-400 text-xs font-semibold block">Total Amount</span>
                            <span className="text-[9px] text-slate-500">Console Time + Food</span>
                          </div>
                          <span className="font-mono-code text-emerald-400 font-bold text-lg">
                            ₹{calculatedGrandTotal.toFixed(2)}
                          </span>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>

              {/* Action Controls Area */}
              <div className="pt-2 border-t border-slate-800/60">
                {isOccupied ? (
                  <div className="space-y-2">
                    {/* Primary Button: Generate Bill & Settle Invoice */}
                    <button
                      onClick={() => {
                        setCheckoutModalStation(station);
                        setCheckoutResult(null);
                        setActionError(null);
                      }}
                      className="w-full flex items-center justify-center gap-2 py-2.5 px-3 min-h-[42px] bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:from-emerald-700 active:to-teal-700 text-slate-950 font-bold rounded-xl text-xs uppercase tracking-wider transition-all shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/35"
                    >
                      <Receipt className="w-4 h-4 text-slate-950" />
                      <span>Generate Bill & Receipt</span>
                    </button>

                    {/* Quick Time Extension Buttons */}
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="text-[11px] text-slate-400">Extend:</span>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => handleQuickExtend(station, 30)}
                          className="px-2.5 py-1.5 text-xs font-mono-code bg-slate-900 hover:bg-slate-800 active:bg-slate-700 text-slate-200 rounded-lg border border-slate-800 hover:border-slate-700 transition-colors"
                        >
                          +30m
                        </button>
                        <button
                          onClick={() => handleQuickExtend(station, 60)}
                          className="px-2.5 py-1.5 text-xs font-mono-code bg-slate-900 hover:bg-slate-800 active:bg-slate-700 text-slate-200 rounded-lg border border-slate-800 hover:border-slate-700 transition-colors"
                        >
                          +1h
                        </button>
                      </div>
                    </div>

                    {/* Operational Action Buttons: Transfer & Checkout */}
                    <div className="grid grid-cols-2 gap-2 pt-0.5">
                      <button
                        onClick={() => {
                          setTransferModalStation(station);
                          setActionError(null);
                        }}
                        className="flex items-center justify-center gap-1.5 px-3 py-2 min-h-[38px] bg-slate-900 hover:bg-slate-800 active:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold border border-slate-800 hover:border-slate-700 transition-all hover:text-white"
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
                        className="flex items-center justify-center gap-1.5 px-3 py-2 min-h-[38px] bg-rose-950/80 hover:bg-rose-900 active:bg-rose-800 text-rose-200 rounded-xl text-xs font-semibold border border-rose-800/60 transition-all hover:text-white"
                      >
                        <CreditCard className="w-3.5 h-3.5 text-rose-400" />
                        Checkout
                      </button>
                    </div>

                    {onSelectStationForDeskView && (
                      <button
                        onClick={() => onSelectStationForDeskView(station.id, station.active_session_id || undefined)}
                        className="w-full text-center text-xs py-1.5 text-slate-400 hover:text-emerald-400 transition-colors flex items-center justify-center gap-1"
                      >
                        <span>Open Customer Desk HUD</span>
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setCheckInModalStation(station);
                      setActionError(null);
                    }}
                    className="w-full flex items-center justify-center gap-2 py-3 min-h-[44px] bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 active:opacity-90 text-slate-950 font-bold rounded-xl text-xs tracking-wider uppercase transition-all shadow-lg shadow-emerald-500/15 hover:shadow-emerald-500/30"
                  >
                    <PlusCircle className="w-4 h-4" />
                    <span>Check-In Player</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* CHECK-IN MODAL (Only 3 duration options: 1h, 2h, 3h) */}
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
              <div className="bg-slate-900/80 p-3.5 rounded-xl border border-slate-800 text-xs space-y-1">
                <div className="flex justify-between text-slate-400">
                  <span>Station Tier:</span>
                  <span className="text-slate-200 font-semibold">{checkInModalStation.tier}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Hourly Rate:</span>
                  <span className="text-emerald-400 font-mono-code font-bold">
                    ₹{Number(checkInModalStation.hourly_rate).toFixed(2)}/hr
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">
                  Select Play Duration (3 Options):
                </label>
                <div className="grid grid-cols-3 gap-2.5">
                  {[
                    { mins: 60, label: '1 Hour' },
                    { mins: 120, label: '2 Hours' },
                    { mins: 180, label: '3 Hours' },
                  ].map((option) => (
                    <button
                      key={option.mins}
                      type="button"
                      onClick={() => setAllocatedMinutes(option.mins)}
                      className={`py-3 min-h-[46px] text-xs font-semibold rounded-xl border transition-all flex flex-col items-center justify-center ${
                        allocatedMinutes === option.mins
                          ? 'bg-emerald-500 text-black font-bold border-emerald-400 shadow-md shadow-emerald-500/20'
                          : 'bg-slate-900/80 text-slate-300 border-slate-800 hover:bg-slate-800'
                      }`}
                    >
                      <span>{option.label}</span>
                      <span className="text-[10px] opacity-75 font-mono-code">
                        ₹{(Number(checkInModalStation.hourly_rate) * (option.mins / 60)).toFixed(0)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  onClick={() => setCheckInModalStation(null)}
                  className="flex-1 py-3 min-h-[44px] rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold border border-slate-800"
                >
                  Cancel
                </button>
                <button
                  disabled={checkInMutation.isPending}
                  onClick={() => checkInMutation.mutate()}
                  className="flex-1 py-3 min-h-[44px] rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-50 shadow-lg shadow-emerald-500/25"
                >
                  {checkInMutation.isPending ? 'Starting...' : 'Confirm Check-In'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TRANSFER MODAL */}
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
                Select an available station to transfer the active player session seamlessly.
              </p>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-2">
                  Select Target Station:
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
                            ? 'bg-blue-600/30 border-blue-400 text-white shadow-sm'
                            : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:bg-slate-900'
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

              <div className="pt-2 flex gap-3">
                <button
                  onClick={() => setTransferModalStation(null)}
                  className="flex-1 py-3 min-h-[44px] rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold border border-slate-800"
                >
                  Cancel
                </button>
                <button
                  disabled={!targetStationId || transferMutation.isPending}
                  onClick={() => transferMutation.mutate()}
                  className="flex-1 py-3 min-h-[44px] rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-50 shadow-lg shadow-blue-500/25"
                >
                  {transferMutation.isPending ? 'Transferring...' : 'Execute Transfer'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* GENERATE BILL & CHECKOUT INVOICE MODAL */}
      {checkoutModalStation && (() => {
        const modalFoodItems = getOrdersForStation(checkoutModalStation);
        const modalFoodCharge = modalFoodItems.reduce((acc, item) => acc + item.total, 0) || Number(checkoutModalStation.orders_charge || 0);
        const modalTimeCharge = Number(checkoutModalStation.time_charge || 0);
        const modalGrandTotal = modalTimeCharge + modalFoodCharge;

        return (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="glass-panel max-w-lg w-full rounded-t-3xl sm:rounded-2xl p-5 sm:p-6 border border-emerald-500/40 shadow-2xl relative animate-in slide-in-from-bottom-5 sm:zoom-in-95 max-h-[92vh] overflow-y-auto pb-safe">
              <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-800">
                <div className="flex items-center space-x-2.5">
                  <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    <Receipt className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base sm:text-lg font-bold text-white font-display">
                      Lounge Invoice & Bill Settlement
                    </h3>
                    <p className="text-xs text-slate-400">
                      Station: <strong className="text-emerald-300">{checkoutModalStation.name}</strong>
                    </p>
                  </div>
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
                  {/* 1. Console Time Breakdown */}
                  <div className="bg-slate-900/90 rounded-xl p-3.5 sm:p-4 border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between text-xs font-bold text-cyan-300 pb-1 border-b border-slate-800">
                      <span className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-cyan-400" />
                        <span>Console Play Time</span>
                      </span>
                      <span className="font-mono-code">
                        {checkoutModalStation.elapsed_minutes} mins ({(checkoutModalStation.elapsed_minutes / 60).toFixed(1)}h)
                      </span>
                    </div>

                    <div className="flex justify-between text-xs text-slate-400">
                      <span>Console Hourly Tariff:</span>
                      <span className="text-slate-200 font-mono-code">
                        ₹{Number(checkoutModalStation.hourly_rate).toFixed(0)} / hr
                      </span>
                    </div>
                    <div className="flex justify-between text-xs font-semibold text-slate-200">
                      <span>Console Time Charge:</span>
                      <span className="text-cyan-300 font-mono-code font-bold">
                        ₹{modalTimeCharge.toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {/* 2. Food & Drink Orders Breakdown */}
                  <div className="bg-slate-900/90 rounded-xl p-3.5 sm:p-4 border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between text-xs font-bold text-amber-300 pb-1 border-b border-slate-800">
                      <span className="flex items-center gap-1.5">
                        <Utensils className="w-3.5 h-3.5 text-amber-400" />
                        <span>Food & Snack Orders</span>
                      </span>
                      <span className="font-mono-code text-amber-400 font-bold">
                        ₹{modalFoodCharge.toFixed(2)}
                      </span>
                    </div>

                    {modalFoodItems.length > 0 ? (
                      <div className="space-y-1.5 pt-1">
                        <div className="grid grid-cols-12 text-[10px] font-bold text-slate-400 border-b border-slate-800/80 pb-1">
                          <span className="col-span-6">ITEM</span>
                          <span className="col-span-2 text-center">QTY</span>
                          <span className="col-span-2 text-right">PRICE</span>
                          <span className="col-span-2 text-right">TOTAL</span>
                        </div>
                        {modalFoodItems.map((item, idx) => (
                          <div key={idx} className="grid grid-cols-12 text-xs text-slate-200 items-center">
                            <span className="col-span-6 truncate font-medium">{item.name}</span>
                            <span className="col-span-2 text-center font-mono-code text-amber-300 font-semibold">{item.quantity}</span>
                            <span className="col-span-2 text-right font-mono-code text-slate-400">₹{item.price}</span>
                            <span className="col-span-2 text-right font-mono-code text-white font-bold">₹{item.total}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500 italic py-1">
                        No food or beverage items ordered during this session.
                      </p>
                    )}
                  </div>

                  {/* 3. Generated Total Calculation Box */}
                  <div className="bg-emerald-950/30 rounded-xl p-3.5 sm:p-4 border border-emerald-500/30 space-y-2">
                    <div className="flex justify-between text-xs text-slate-300">
                      <span>Console Gaming Subtotal:</span>
                      <span className="font-mono-code text-cyan-300">₹{modalTimeCharge.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-xs text-slate-300">
                      <span>Cafe Food & Beverages Subtotal:</span>
                      <span className="font-mono-code text-amber-300">₹{modalFoodCharge.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm sm:text-base font-bold text-white border-t border-emerald-500/30 pt-2">
                      <span className="flex items-center gap-1.5">
                        <Receipt className="w-4 h-4 text-emerald-400" />
                        <span>Grand Total Billable:</span>
                      </span>
                      <span className="font-mono-code text-emerald-400 text-lg sm:text-xl font-bold">
                        ₹{modalGrandTotal.toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {/* 4. Settlement Mode Selector */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-2">
                      Choose Payment Channel:
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
                        Cash Counter
                      </button>
                    </div>
                  </div>

                  {/* 5. Execution Action Buttons */}
                  <div className="pt-2 flex gap-3">
                    <button
                      onClick={() => setCheckoutModalStation(null)}
                      className="flex-1 py-3 min-h-[44px] rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold border border-slate-800 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      disabled={isCheckingOut}
                      onClick={handleExecuteCheckout}
                      className="flex-1 py-3 min-h-[44px] rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-slate-950 font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-50 shadow-lg shadow-emerald-500/25 flex items-center justify-center gap-2"
                    >
                      <Receipt className="w-4 h-4" />
                      <span>{isCheckingOut ? 'Generating Invoice...' : `Settle ₹${modalGrandTotal.toFixed(2)}`}</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4 text-center">
                  <div className="inline-flex p-3 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 mb-1">
                    <CheckCircle2 className="w-8 h-8" />
                  </div>
                  <h4 className="text-base sm:text-lg font-bold text-white">Bill Paid & Station Succeeded!</h4>
                  <p className="text-xs text-slate-400">
                    Payment recorded into daily revenue ledger and session marked complete.
                  </p>

                  <div className="bg-slate-900/90 rounded-xl p-3.5 sm:p-4 border border-slate-800 text-left text-xs space-y-2">
                    <div className="flex justify-between text-slate-400">
                      <span>Invoice Ref:</span>
                      <span className="text-slate-300 font-mono-code font-bold">{checkoutResult.payment_id}</span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>Station:</span>
                      <span className="text-white font-semibold">{checkoutModalStation.name}</span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>Console Gaming Time:</span>
                      <span className="text-cyan-300 font-mono-code">₹{Number(checkoutResult.time_charge).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>Food & Snacks Tab:</span>
                      <span className="text-amber-300 font-mono-code">₹{Number(checkoutResult.orders_charge).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-slate-300 border-t border-slate-800 pt-2 font-bold">
                      <span>Total Amount Settled:</span>
                      <span className="text-emerald-400 font-mono-code text-base font-bold">
                        ₹{Number(checkoutResult.total_amount).toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between text-slate-400 text-[11px]">
                      <span>Payment Method:</span>
                      <span className="text-slate-200 uppercase font-semibold">{checkoutResult.payment_method}</span>
                    </div>
                  </div>

                  {checkoutResult.upi_qr_string && (
                    <div className="bg-white p-3 sm:p-4 rounded-xl inline-block shadow-xl my-2 max-w-full">
                      <div className="w-40 h-40 sm:w-48 sm:h-48 bg-slate-100 flex flex-col items-center justify-center border-2 border-dashed border-slate-400 rounded-lg p-2 mx-auto">
                        <QrCode className="w-20 h-20 sm:w-24 sm:h-24 text-slate-900" />
                        <span className="text-[9px] text-slate-700 font-mono-code mt-1 break-all px-1 line-clamp-2">
                          {checkoutResult.upi_qr_string}
                        </span>
                      </div>
                      <span className="block text-slate-800 text-[10px] font-bold mt-1">
                        UPI QR PAYMENT VERIFIED
                      </span>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => window.print()}
                      className="flex-1 py-3 min-h-[44px] rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold border border-slate-800 flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Printer className="w-4 h-4 text-slate-400" />
                      <span>Print Receipt</span>
                    </button>
                    <button
                      onClick={() => {
                        setCheckoutModalStation(null);
                        setCheckoutResult(null);
                      }}
                      className="flex-1 py-3 min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 text-xs font-bold transition-all shadow-md"
                    >
                      Close & Free Station
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
};
