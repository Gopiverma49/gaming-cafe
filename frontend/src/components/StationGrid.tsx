import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Monitor,
  ArrowRightLeft,
  CreditCard,
  Banknote,
  AlertCircle,
  XCircle,
  Receipt,
  Users,
  SlidersHorizontal,
  Gamepad2,
  Percent,
} from 'lucide-react';
import { StationLive, PricingTier, MatrixSession, StationMatrixData } from '../types';
import { POLL_INTERVALS } from '../constants';
import {
  fetchLiveStations,
  fetchStationMatrix,
  transferStation,
  checkoutSession,
} from '../api';
import { useLoungeStore } from '../store/loungeStore';
import { useNotificationStore } from '../store/notificationStore';
import { useAuthStore } from '../store/authStore';
import { SessionUpsellDrawer } from './SessionUpsellDrawer';
import { StationFoodOrderModal } from './StationFoodOrderModal';
import { CustomerLogs } from './CustomerLogs';
import { ManageStation } from './ManageStation';
import { ConsoleMatrixDashboard } from './ConsoleMatrixDashboard';

export type StationSubTab = 'stations' | 'customer_logs' | 'manage_station';

export const StationGrid: React.FC = () => {
  const queryClient = useQueryClient();
  const { addNotification } = useNotificationStore();
  const { clearStationFoodOrders } = useLoungeStore();

  // Sub-navigation state under Station option
  const [activeSubTab, setActiveSubTab] = useState<StationSubTab>('stations');

  // Unified Modals States
  const [bookingStation, setBookingStation] = useState<StationLive | null>(null);
  const [bookingTier, setBookingTier] = useState<PricingTier | null>(null);
  const [foodOrderStation, setFoodOrderStation] = useState<StationLive | null>(null);

  // Transfer Station Modal
  const [transferStationTarget, setTransferStationTarget] = useState<StationLive | null>(null);
  const [targetStationId, setTargetStationId] = useState<string>('');

  // Checkout Modal
  const [checkoutStationTarget, setCheckoutStationTarget] = useState<StationLive | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'UPI'>('CASH');
  const [selectedDiscountPercent, setSelectedDiscountPercent] = useState<number>(0);
  const [isCheckingOut, setIsCheckingOut] = useState(false);

  // Station Matrix Query for column availability & active sessions
  const { data: matrixData } = useQuery<StationMatrixData>({
    queryKey: ['station-matrix'],
    queryFn: fetchStationMatrix,
  });

  // Global Action Error
  const [actionError, setActionError] = useState<string | null>(null);

  // Live Stations Query (Only active when in manage station or when checkout/transfer modal is open)
  const { data: stations = [], refetch } = useQuery<StationLive[]>({
    queryKey: ['stations-live'],
    queryFn: fetchLiveStations,
    refetchInterval: POLL_INTERVALS.STATIONS,
    enabled: activeSubTab === 'manage_station' || !!checkoutStationTarget || !!transferStationTarget,
  });

  // Safe Array fallback
  const safeStations = Array.isArray(stations) ? stations : [];

  // Self-healing check: if any station is occupied but active_session_id is missing,
  // it indicates the query executed before admin auth token was injected. Re-acquire token and refetch.
  React.useEffect(() => {
    const hasSanitizedOccupied = safeStations.some(
      (s) => (s.is_occupied || s.status === 'OCCUPIED') && !s.active_session_id
    );
    if (hasSanitizedOccupied) {
      useAuthStore.getState().ensureAdminToken(true).then((tok: string | null) => {
        if (tok) refetch();
      });
    }
  }, [safeStations, refetch]);

  // Transfer Mutation
  const transferMutation = useMutation({
    mutationFn: () => {
      if (!transferStationTarget?.active_session_id || !targetStationId) {
        throw new Error('Invalid transfer parameters: session or target station missing.');
      }
      const isDeviceName = targetStationId.startsWith('PS') || targetStationId.startsWith('VR') || !targetStationId.includes('-');
      return transferStation(
        transferStationTarget.active_session_id,
        isDeviceName ? undefined : targetStationId,
        isDeviceName ? targetStationId : undefined
      );
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['station-matrix'] }),
        queryClient.refetchQueries({ queryKey: ['stations-live'] }),
        queryClient.refetchQueries({ queryKey: ['customer-sessions'] }),
        queryClient.refetchQueries({ queryKey: ['kitchen-orders'] }),
      ]);
      setTransferStationTarget(null);
      setTargetStationId('');
      setActionError(null);
      addNotification('SYSTEM', '🔄 Session Transferred', 'Session moved to new station.');
    },
    onError: (err: any) => setActionError(err.message || 'Transfer failed'),
  });

  // Quick Extend Handler
  const handleQuickExtend = (station: StationLive, minutes: number) => {
    addNotification(
      'SYSTEM',
      '⏱️ Session Extended',
      `Extended ${station?.name || 'Station'} by +${minutes} minutes.`
    );
  };

  // Checkout Execution
  const handleExecuteCheckout = async () => {
    if (!checkoutStationTarget) return;
    setIsCheckingOut(true);
    setActionError(null);
    try {
      let targetSessionId = checkoutStationTarget.active_session_id;

      if (!targetSessionId) {
        // Attempt fresh token & station refetch before failing
        const freshToken = await useAuthStore.getState().ensureAdminToken(true);
        if (freshToken) {
          const freshStations = await fetchLiveStations();
          const refreshed = freshStations.find((s) => s.id === checkoutStationTarget.id || s.name === checkoutStationTarget.name);
          if (refreshed?.active_session_id) {
            targetSessionId = refreshed.active_session_id;
          }
        }
      }

      if (!targetSessionId) {
        setActionError('No active session found for this station.');
        return;
      }

      // Call backend with optional operator discount percent
      const apiRes = await checkoutSession(targetSessionId, paymentMethod, selectedDiscountPercent);

      // Backend confirmed checkout: refresh station list from server immediately
      clearStationFoodOrders(checkoutStationTarget.name);
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['station-matrix'] }),
        queryClient.refetchQueries({ queryKey: ['stations-live'] }),
        queryClient.refetchQueries({ queryKey: ['customer-sessions'] }),
        queryClient.refetchQueries({ queryKey: ['kitchen-orders'] }),
        queryClient.refetchQueries({ queryKey: ['admin-customers'] }),
      ]);

      const settledStationName = checkoutStationTarget.name;
      const settledAmount = Number(apiRes.total_amount || 0).toFixed(2);
      setCheckoutStationTarget(null);
      setSelectedDiscountPercent(0);
      addNotification(
        'SYSTEM',
        '💳 Invoice Settled',
        `Station ${settledStationName} settled for ₹${settledAmount} via ${paymentMethod}. Station is now available.`
      );
    } catch (err: any) {
      setActionError(err.message || 'Checkout failed. Please try again.');
    } finally {
      setIsCheckingOut(false);
    }
  };

  // Matrix action adapters
  const handleMatrixOrderFood = (session: MatrixSession, stationName: string) => {
    const matched = safeStations.find(
      (s) => s.id === session.station_id || s.name.toUpperCase() === stationName.toUpperCase()
    );
    setFoodOrderStation(
      matched
        ? { ...matched, active_session_id: session.session_id, name: stationName || matched.name }
        : {
            id: session.station_id || session.session_id,
            name: stationName,
            tier: 'CONSOLE',
            hourly_rate: session.hourly_rate,
            status: 'OCCUPIED',
            is_occupied: true,
            active_session_id: session.session_id,
            time_charge: session.time_charge,
            orders_charge: session.orders_charge,
            running_total: session.running_total,
            elapsed_minutes: session.elapsed_minutes,
            remaining_minutes: session.remaining_minutes,
            active_orders_count: session.active_orders_count,
            customer_name: session.customer_name,
            customer_phone: session.customer_phone,
          }
    );
  };

  const handleMatrixCheckout = (session: MatrixSession, stationName: string) => {
    setSelectedDiscountPercent(0);
    const matched = safeStations.find(
      (s) => s.id === session.station_id || s.name.toUpperCase() === stationName.toUpperCase()
    );
    setCheckoutStationTarget(
      matched || {
        id: session.station_id || session.session_id,
        name: stationName,
        tier: 'CONSOLE',
        hourly_rate: session.hourly_rate,
        status: 'OCCUPIED',
        is_occupied: true,
        active_session_id: session.session_id,
        time_charge: session.time_charge,
        orders_charge: session.orders_charge,
        running_total: session.running_total,
        elapsed_minutes: session.elapsed_minutes,
        remaining_minutes: session.remaining_minutes,
        active_orders_count: session.active_orders_count,
        customer_name: session.customer_name,
        customer_phone: session.customer_phone,
      }
    );
  };

  const handleMatrixTransfer = (session: MatrixSession, stationName: string) => {
    const matched = safeStations.find(
      (s) => s.id === session.station_id || s.name.toUpperCase() === stationName.toUpperCase()
    );
    setTransferStationTarget(
      matched
        ? {
            ...matched,
            active_session_id: session.session_id,
            name: stationName || matched.name,
            device_name: stationName,
          }
        : {
            id: session.station_id || session.session_id,
            name: stationName,
            device_name: stationName,
            tier: 'CONSOLE',
            hourly_rate: session.hourly_rate,
            status: 'OCCUPIED',
            is_occupied: true,
            active_session_id: session.session_id,
            time_charge: session.time_charge,
            orders_charge: session.orders_charge,
            running_total: session.running_total,
            elapsed_minutes: session.elapsed_minutes,
            remaining_minutes: session.remaining_minutes,
            active_orders_count: session.active_orders_count,
            customer_name: session.customer_name,
            customer_phone: session.customer_phone,
          }
    );
    setTargetStationId('');
  };

  // Transfer options: strictly available PS console columns (PS1, PS2, PS3)
  const transferOptions = useMemo(() => {
    const list: { id: string; name: string; desc: string }[] = [];
    const originName = (
      transferStationTarget?.device_name ||
      transferStationTarget?.name ||
      ''
    ).trim().toUpperCase();

    const allowedColumns = ['PS1', 'PS2', 'PS3'];
    const originCol = allowedColumns.find(
      (c) => originName === c || originName.startsWith(c) || originName.includes(c)
    );

    allowedColumns.forEach((col) => {
      // 1. Exclude the current column origin
      if (col === originCol || col === originName) return;

      // 2. Check if occupied in matrixData stations
      const matrixStation = matrixData?.stations?.find(
        (s) => s.name?.toUpperCase() === col || s.id?.toUpperCase() === col
      );
      const isOccupiedInMatrix = !!matrixStation?.active_session;

      // 3. Check if occupied in safeStations
      const isOccupiedInStations = safeStations.some(
        (s) =>
          (s.is_occupied || s.status === 'OCCUPIED') &&
          ((s.device_name && s.device_name.toUpperCase() === col) ||
            s.name.toUpperCase() === col)
      );

      if (!isOccupiedInMatrix && !isOccupiedInStations) {
        list.push({ id: col, name: col, desc: 'Available Console' });
      }
    });

    return list;
  }, [safeStations, matrixData, transferStationTarget]);

  return (
    <div className="space-y-6 relative z-10">
      {/* 1. Sub-navigation Header Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2.5">
            <Monitor className="w-6 h-6 text-emerald-400" />
            <h2 className="text-xl sm:text-2xl font-bold font-display text-white tracking-wide">
              Station Management & Operations
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Console fleet operations, customer directory logs, and station configuration.
          </p>
        </div>

        {/* Sub-options Switcher: Customer Logs, Manage Station, Console Stations */}
        <div className="flex items-center bg-slate-950/90 p-1.5 rounded-2xl border border-slate-800/90 shadow-inner gap-1 flex-wrap self-start md:self-auto">
          <button
            onClick={() => setActiveSubTab('stations')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold font-display tracking-wider transition-all ${
              activeSubTab === 'stations'
                ? 'bg-emerald-500 text-slate-950 shadow-md font-black'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Gamepad2 className="w-4 h-4" />
            <span>Console Stations</span>
          </button>

          <button
            onClick={() => setActiveSubTab('customer_logs')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold font-display tracking-wider transition-all ${
              activeSubTab === 'customer_logs'
                ? 'bg-cyan-500 text-slate-950 shadow-md font-black'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Customer Logs</span>
          </button>

          <button
            onClick={() => setActiveSubTab('manage_station')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold font-display tracking-wider transition-all ${
              activeSubTab === 'manage_station'
                ? 'bg-amber-500 text-slate-950 shadow-md font-black'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" />
            <span>Manage Station</span>
          </button>
        </div>
      </div>

      {/* Global Error Banner */}
      {actionError && (
        <div className="p-3.5 rounded-xl bg-rose-950/90 border border-rose-600/80 text-rose-200 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{actionError}</span>
          </div>
          <button onClick={() => setActionError(null)} className="text-rose-400 hover:text-white p-1">
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. SUB-OPTION VIEW 1: CUSTOMER LOGS */}
      {/* ========================================================================= */}
      {activeSubTab === 'customer_logs' && <CustomerLogs />}

      {/* ========================================================================= */}
      {/* 3. SUB-OPTION VIEW 2: MANAGE STATION */}
      {/* ========================================================================= */}
      {activeSubTab === 'manage_station' && <ManageStation />}

      {/* ========================================================================= */}
      {/* 4. SUB-OPTION VIEW 3: 2D CONSOLE STATIONS ALLOCATION MATRIX */}
      {/* ========================================================================= */}
      {activeSubTab === 'stations' && (
        <ConsoleMatrixDashboard
          onOrderFood={handleMatrixOrderFood}
          onCheckout={handleMatrixCheckout}
          onTransfer={handleMatrixTransfer}
          onQuickExtend={(sess, mins) => {
            handleQuickExtend({ name: sess.station_id } as any, mins);
          }}
        />
      )}

      {/* ========================================================================= */}
      {/* MODALS (BOOKING, FOOD ORDER, CHECKOUT, TRANSFER) */}
      {/* ========================================================================= */}

      {/* 1. Interactive Session Upsell & Check-In Drawer (Admin Front-Desk) */}
      <SessionUpsellDrawer
        isOpen={!!bookingStation}
        station={bookingStation}
        selectedTier={bookingTier}
        onClose={() => {
          setBookingStation(null);
          setBookingTier(null);
        }}
        isAdmin={true}
        defaultCustomerName="Walk-in Gamer"
      />

      {/* 2. Unified Food Order Modal (Exact Same for Admin Walk-in) */}
      <StationFoodOrderModal
        isOpen={!!foodOrderStation}
        station={foodOrderStation}
        onClose={() => setFoodOrderStation(null)}
        isAdmin={true}
      />

      {/* 3. Transfer Session Modal */}
      {transferStationTarget && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 max-w-md w-full rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="w-5 h-5 text-blue-400" />
                <h3 className="font-bold text-white font-display">Transfer Active Session</h3>
              </div>
              <button
                onClick={() => setTransferStationTarget(null)}
                className="text-slate-400 hover:text-white"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-300">
              Moving player from <strong className="text-white">{transferStationTarget.name}</strong> to:
            </p>

            {transferOptions.length === 0 ? (
              <p className="text-xs text-rose-400 bg-rose-950/40 p-3 rounded-xl border border-rose-900/50">
                No available PS consoles (PS1, PS2, PS3) are free to receive transfer right now.
              </p>
            ) : (
              <select
                value={targetStationId}
                onChange={(e) => setTargetStationId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-blue-500"
              >
                <option value="">Select Destination Console (PS1, PS2, PS3)</option>
                {transferOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.name} ({opt.desc})
                  </option>
                ))}
              </select>
            )}

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setTransferStationTarget(null)}
                className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                disabled={!targetStationId || transferMutation.isPending}
                onClick={() => transferMutation.mutate()}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50"
              >
                {transferMutation.isPending ? 'Transferring...' : targetStationId ? `Transfer to ${targetStationId}` : 'Confirm Transfer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Checkout & Settle Modal */}
      {checkoutStationTarget && (() => {
        const timeCharge = Number(checkoutStationTarget.time_charge || 0);
        const ordersCharge = Number(checkoutStationTarget.orders_charge || 0);
        const rawSubtotal = timeCharge + ordersCharge;
        const discountAmount = selectedDiscountPercent > 0 ? (rawSubtotal * selectedDiscountPercent) / 100 : 0;
        const finalGrandTotal = Math.max(0, rawSubtotal - discountAmount);

        return (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="bg-slate-900 border border-slate-800 max-w-lg w-full rounded-t-3xl sm:rounded-3xl p-5 sm:p-6 shadow-2xl relative animate-in slide-in-from-bottom-5 max-h-[90vh] overflow-y-auto pb-safe">
              <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <Receipt className="w-5 h-5 text-emerald-400" />
                  <h3 className="text-base sm:text-lg font-bold text-white font-display">
                    Settle Invoice: {checkoutStationTarget.name}
                  </h3>
                </div>
                <button
                  onClick={() => {
                    setCheckoutStationTarget(null);
                    setSelectedDiscountPercent(0);
                  }}
                  className="text-slate-400 hover:text-white p-1"
                >
                  <XCircle className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4 text-xs">
                {/* Cost Breakdown */}
                <div className="p-4 bg-slate-950/90 rounded-2xl border border-slate-800 space-y-2">
                  <div className="flex justify-between text-slate-400">
                    <span>Console Play Time:</span>
                    <span className="font-mono-code text-white">
                      ₹{timeCharge.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Food &amp; Drink Orders:</span>
                    <span className="font-mono-code text-white">
                      ₹{ordersCharge.toFixed(2)}
                    </span>
                  </div>
                  {selectedDiscountPercent > 0 && (
                    <div className="flex justify-between text-emerald-400 font-medium">
                      <span className="flex items-center gap-1">
                        <Percent className="w-3.5 h-3.5" />
                        <span>Discount ({selectedDiscountPercent}% OFF):</span>
                      </span>
                      <span className="font-mono-code">
                        -₹{discountAmount.toFixed(2)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-white pt-1.5 border-t border-slate-800 text-sm">
                    <span>Grand Total Due:</span>
                    <span className="font-mono-code text-emerald-400 text-base">
                      ₹{finalGrandTotal.toFixed(2)}
                    </span>
                  </div>
                </div>

                {/* Discount Options: 5%, 10%, 15%, 20% */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="font-semibold text-slate-300 flex items-center gap-1.5">
                      <Percent className="w-4 h-4 text-amber-400" />
                      <span>Apply Discount:</span>
                    </label>
                    {selectedDiscountPercent > 0 && (
                      <span className="text-[11px] font-mono-code text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded-full font-bold">
                        {selectedDiscountPercent}% OFF (-₹{discountAmount.toFixed(2)})
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-5 gap-1.5">
                    {[0, 5, 10, 15, 20].map((pct) => (
                      <button
                        key={pct}
                        type="button"
                        onClick={() => setSelectedDiscountPercent(pct)}
                        className={`py-2 px-1 rounded-xl border text-xs font-bold font-mono-code transition-all cursor-pointer text-center ${
                          selectedDiscountPercent === pct
                            ? 'bg-amber-500/20 border-amber-400 text-amber-300 shadow-sm ring-1 ring-amber-400/50'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                        }`}
                      >
                        {pct === 0 ? 'None' : `${pct}%`}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Payment Method */}
                <div>
                  <label className="block font-semibold text-slate-300 mb-2">
                    Payment Method:
                  </label>
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('UPI')}
                      className={`p-3 rounded-xl border flex items-center justify-center gap-2 font-bold transition-all cursor-pointer ${
                        paymentMethod === 'UPI'
                          ? 'bg-blue-600/20 border-blue-400 text-blue-300 shadow-sm'
                          : 'bg-slate-950 border-slate-800 text-slate-400'
                      }`}
                    >
                      <CreditCard className="w-4 h-4" />
                      <span>UPI / QR</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('CASH')}
                      className={`p-3 rounded-xl border flex items-center justify-center gap-2 font-bold transition-all cursor-pointer ${
                        paymentMethod === 'CASH'
                          ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300 shadow-sm'
                          : 'bg-slate-950 border-slate-800 text-slate-400'
                      }`}
                    >
                      <Banknote className="w-4 h-4" />
                      <span>Cash</span>
                    </button>
                  </div>
                </div>

                <div className="pt-2 flex gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setCheckoutStationTarget(null);
                      setSelectedDiscountPercent(0);
                    }}
                    className="flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={isCheckingOut}
                    onClick={handleExecuteCheckout}
                    className="flex-1 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-bold uppercase tracking-wider disabled:opacity-50 cursor-pointer shadow-lg"
                  >
                    {isCheckingOut ? 'Processing...' : 'Settle Invoice'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
