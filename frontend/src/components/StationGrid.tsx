import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Monitor,
  ArrowRightLeft,
  CreditCard,
  Banknote,
  AlertCircle,
  CheckCircle2,
  XCircle,
  QrCode,
  Receipt,
  Users,
  SlidersHorizontal,
  Gamepad2,
} from 'lucide-react';
import { StationLive, CheckoutResult } from '../types';
import {
  fetchLiveStations,
  transferStation,
  checkoutSession,
} from '../api';
import { useLoungeStore } from '../store/loungeStore';
import { useNotificationStore } from '../store/notificationStore';
import { StationCard } from './StationCard';
import { StationBookingModal } from './StationBookingModal';
import { StationFoodOrderModal } from './StationFoodOrderModal';
import { CustomerLogs } from './CustomerLogs';
import { ManageStation } from './ManageStation';

export type StationSubTab = 'stations' | 'customer_logs' | 'manage_station';

export const StationGrid: React.FC = () => {
  const queryClient = useQueryClient();
  const { addNotification } = useNotificationStore();
  const { clearStationFoodOrders } = useLoungeStore();

  // Sub-navigation state under Station option
  const [activeSubTab, setActiveSubTab] = useState<StationSubTab>('stations');

  // Unified Modals States
  const [bookingStation, setBookingStation] = useState<StationLive | null>(null);
  const [foodOrderStation, setFoodOrderStation] = useState<StationLive | null>(null);

  // Transfer Modal
  const [transferStationTarget, setTransferStationTarget] = useState<StationLive | null>(null);
  const [targetStationId, setTargetStationId] = useState<string>('');

  // Checkout Modal
  const [checkoutStationTarget, setCheckoutStationTarget] = useState<StationLive | null>(null);
  const [checkoutResult, setCheckoutResult] = useState<CheckoutResult | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'UPI' | 'CASH'>('UPI');
  const [isCheckingOut, setIsCheckingOut] = useState(false);

  // Global Action Error
  const [actionError, setActionError] = useState<string | null>(null);

  // Live Stations Query
  const { data: stations = [], isLoading } = useQuery<StationLive[]>({
    queryKey: ['stations-live'],
    queryFn: fetchLiveStations,
    refetchInterval: 6000,
  });

  // Transfer Mutation
  const transferMutation = useMutation({
    mutationFn: () =>
      transferStation(transferStationTarget!.active_session_id!, targetStationId),
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: ['stations-live'] });
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
      `Extended ${station.name} by +${minutes} minutes.`
    );
  };

  // Checkout Execution
  const handleExecuteCheckout = async () => {
    if (!checkoutStationTarget) return;
    setIsCheckingOut(true);
    setActionError(null);
    try {
      if (!checkoutStationTarget.active_session_id) {
        setActionError('No active session found for this station.');
        return;
      }

      // Call backend — must succeed for station to actually close
      const apiRes = await checkoutSession(checkoutStationTarget.active_session_id, paymentMethod);

      // Backend confirmed checkout: refresh station list from server
      clearStationFoodOrders(checkoutStationTarget.name);
      await queryClient.refetchQueries({ queryKey: ['stations-live'] });

      setCheckoutResult(apiRes);
    } catch (err: any) {
      setActionError(err.message || 'Checkout failed. Please try again.');
    } finally {
      setIsCheckingOut(false);
    }
  };

  const availableStationsForTransfer = stations.filter(
    (s) => s.status === 'AVAILABLE' && s.id !== transferStationTarget?.id
  );

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
      {/* 4. SUB-OPTION VIEW 3: CONSOLE STATIONS FLEET */}
      {/* ========================================================================= */}
      {activeSubTab === 'stations' && (
        <>
          {isLoading ? (
            <div className="flex items-center justify-center p-16 bg-slate-900/50 rounded-3xl border border-slate-800">
              <div className="w-8 h-8 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin" />
            </div>
          ) : stations.length === 0 ? (
            <div className="p-12 text-center bg-slate-900/50 rounded-3xl border border-dashed border-slate-800 space-y-2">
              <Monitor className="w-10 h-10 text-slate-600 mx-auto" />
              <p className="text-sm text-slate-400">No stations configured yet.</p>
              <button
                onClick={() => setActiveSubTab('manage_station')}
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl transition-all uppercase"
              >
                Go to Manage Station
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
              {stations.map((station) => (
                <StationCard
                  key={station.id}
                  station={station}
                  isAdmin={true}
                  onBookStation={(s) => setBookingStation(s)}
                  onOrderFood={(s) => setFoodOrderStation(s)}
                  onCheckout={(s) => {
                    setCheckoutStationTarget(s);
                    setCheckoutResult(null);
                  }}
                  onTransfer={(s) => {
                    setTransferStationTarget(s);
                    setTargetStationId('');
                  }}
                  onQuickExtend={handleQuickExtend}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* ========================================================================= */}
      {/* MODALS (BOOKING, FOOD ORDER, CHECKOUT, TRANSFER) */}
      {/* ========================================================================= */}

      {/* 1. Unified Booking Modal (Exact Same for Admin Walk-in) */}
      <StationBookingModal
        isOpen={!!bookingStation}
        station={bookingStation}
        onClose={() => setBookingStation(null)}
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

            {availableStationsForTransfer.length === 0 ? (
              <p className="text-xs text-rose-400 bg-rose-950/40 p-3 rounded-xl border border-rose-900/50">
                No available stations free to receive transfer right now.
              </p>
            ) : (
              <select
                value={targetStationId}
                onChange={(e) => setTargetStationId(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-blue-500"
              >
                <option value="">Select Destination Station</option>
                {availableStationsForTransfer.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.name} ({st.tier} - ₹{st.hourly_rate}/hr)
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
                {transferMutation.isPending ? 'Transferring...' : 'Confirm Transfer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Checkout & Settle Modal */}
      {checkoutStationTarget && (
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
                onClick={() => setCheckoutStationTarget(null)}
                className="text-slate-400 hover:text-white p-1"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            {checkoutResult ? (
              <div className="space-y-4 animate-in fade-in">
                <div className="p-4 rounded-2xl bg-emerald-950/60 border border-emerald-500/50 flex items-center gap-3">
                  <CheckCircle2 className="w-8 h-8 text-emerald-400 shrink-0" />
                  <div>
                    <h4 className="font-bold text-white text-sm">Session Successfully Closed!</h4>
                    <p className="text-xs text-emerald-300/80">
                      Payment recorded via {checkoutResult.payment_method}. Station is now available.
                    </p>
                  </div>
                </div>

                {checkoutResult.upi_qr_string && checkoutResult.payment_method === 'UPI' && (
                  <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 text-center space-y-3">
                    <div className="inline-flex p-3 bg-white rounded-xl shadow-md">
                      <QrCode className="w-32 h-32 text-black" />
                    </div>
                    <div>
                      <p className="text-xs font-mono-code text-slate-400">Scan & Pay via UPI</p>
                      <p className="text-lg font-black text-emerald-400 font-mono-code">
                        ₹{Number(checkoutResult.total_amount || 0).toFixed(2)}
                      </p>
                    </div>
                  </div>
                )}

                <div className="p-4 bg-slate-950/80 rounded-2xl border border-slate-800 text-xs space-y-2">
                  <div className="flex justify-between text-slate-400">
                    <span>Play Time Charge:</span>
                    <span className="font-mono-code text-white">
                      ₹{Number(checkoutResult.station_charge || checkoutResult.time_charge || 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Food &amp; Snacks:</span>
                    <span className="font-mono-code text-white">
                      ₹{Number(checkoutResult.orders_charge || 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between font-bold text-white pt-2 border-t border-slate-800">
                    <span>Total Settled:</span>
                    <span className="font-mono-code text-emerald-400 text-sm">
                      ₹{Number(checkoutResult.total_amount || 0).toFixed(2)}
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => setCheckoutStationTarget(null)}
                  className="w-full py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs uppercase tracking-wider transition-all"
                >
                  Done & Close
                </button>
              </div>
            ) : (
              <div className="space-y-4 text-xs">
                {/* Cost Breakdown */}
                <div className="p-4 bg-slate-950/90 rounded-2xl border border-slate-800 space-y-2">
                  <div className="flex justify-between text-slate-400">
                    <span>Console Play Time:</span>
                    <span className="font-mono-code text-white">
                      ₹{Number(checkoutStationTarget.time_charge || 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Food & Drink Orders:</span>
                    <span className="font-mono-code text-white">
                      ₹{Number(checkoutStationTarget.orders_charge || 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between font-bold text-white pt-1.5 border-t border-slate-800 text-sm">
                    <span>Grand Total Due:</span>
                    <span className="font-mono-code text-emerald-400 text-base">
                      ₹{(
                        Number(checkoutStationTarget.time_charge || 0) +
                        Number(checkoutStationTarget.orders_charge || 0)
                      ).toFixed(2)}
                    </span>
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
                      className={`p-3 rounded-xl border flex items-center justify-center gap-2 font-bold transition-all ${
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
                      className={`p-3 rounded-xl border flex items-center justify-center gap-2 font-bold transition-all ${
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
                    onClick={() => setCheckoutStationTarget(null)}
                    className="flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={isCheckingOut}
                    onClick={handleExecuteCheckout}
                    className="flex-1 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-bold uppercase tracking-wider disabled:opacity-50"
                  >
                    {isCheckingOut ? 'Processing...' : 'Settle Invoice'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
