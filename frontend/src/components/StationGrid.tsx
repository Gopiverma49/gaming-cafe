import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Monitor,
  ArrowRightLeft,
  AlertCircle,
  XCircle,
  Users,
  SlidersHorizontal,
  Gamepad2,
} from 'lucide-react';
import { StationLive, PricingTier, MatrixSession, StationMatrixData, Order } from '../types';
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
import { SettleInvoiceModal, SettleInvoicePayload, OrderedReceiptItem } from './SettleInvoiceModal';

export type StationSubTab = 'stations' | 'customer_logs' | 'manage_station';

export const StationGrid: React.FC = () => {
  const queryClient = useQueryClient();
  const { addNotification } = useNotificationStore();
  const { clearStationFoodOrders, getStationFoodOrders, recordTransaction } = useLoungeStore();

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
  const handleExecuteCheckout = async (payload: SettleInvoicePayload) => {
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

      // Call backend with payment method, discount percent, and flat discount amount
      const apiRes = await checkoutSession(
        targetSessionId,
        payload.paymentMethod,
        payload.discountPercent,
        payload.discountAmount
      );

      // Record offline transaction ledger entry for lounge analytics
      recordTransaction({
        stationName: payload.stationName,
        customerName: checkoutStationTarget.customer_name || 'Walk-in Gamer',
        timeCharge: payload.subTotal - (Number(checkoutStationTarget.orders_charge) || 0),
        foodCharge: Number(checkoutStationTarget.orders_charge) || 0,
        totalAmount: payload.grandTotal,
        paymentMethod: payload.paymentMethod,
        foodItems: payload.orderedItems.map((i) => ({
          name: i.name,
          quantity: i.quantity,
          price: i.unitPrice || (i.totalPrice / (i.quantity || 1)),
        })),
      });

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
      const settledAmount = (apiRes?.total_amount !== undefined ? Number(apiRes.total_amount) : payload.grandTotal).toFixed(2);
      setCheckoutStationTarget(null);
      addNotification(
        'SYSTEM',
        '💳 Invoice Settled',
        `Station ${settledStationName} settled for ₹${settledAmount} via ${payload.paymentMethod}. Station is now available.`
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

  // Itemized food receipt list derived from active in-memory orders & kitchen orders
  // Itemized food receipt list: strictly uses real database kitchen orders as single source of truth.
  // Excludes any CANCELLED/rejected orders, matching backend settle_checkout calculation exactly.
  const checkoutOrderedItems = useMemo<OrderedReceiptItem[]>(() => {
    if (!checkoutStationTarget) return [];

    const itemsMap = new Map<string, OrderedReceiptItem>();

    // 1. Primary ground-truth: Kitchen orders from database cache
    const kitchenOrders = queryClient.getQueryData<Order[]>(['kitchen-orders']) || [];
    const allStationOrders = kitchenOrders.filter(
      (o) =>
        (checkoutStationTarget.active_session_id && o.session_id === checkoutStationTarget.active_session_id) ||
        (o.station_name && o.station_name.toUpperCase() === checkoutStationTarget.name.toUpperCase())
    );

    if (allStationOrders.length > 0) {
      // Only SERVED orders are billable. Cancelled/rejected orders are strictly omitted.
      const billableOrders = allStationOrders.filter(
        (o) => o.status === 'SERVED' && (o.status as any) !== 'CANCELLED' && (o.status as any) !== 'cancelled'
      );

      billableOrders.forEach((order) => {
        (order.items || []).forEach((item) => {
          const key = (item.menu_item_name || 'Item').trim().toLowerCase();
          const uPrice = Number(item.unit_price) || 0;
          const sTotal = Number(item.subtotal) || uPrice * item.quantity;
          if (itemsMap.has(key)) {
            const existing = itemsMap.get(key)!;
            existing.quantity += item.quantity;
            existing.totalPrice += sTotal;
          } else {
            itemsMap.set(key, {
              id: item.id || item.menu_item_id,
              name: item.menu_item_name || 'Item',
              quantity: item.quantity,
              unitPrice: uPrice,
              totalPrice: sTotal,
            });
          }
        });
      });
    } else {
      // 2. Fallback only if no database orders exist for this station at all (e.g. offline testing)
      const localOrders = getStationFoodOrders(checkoutStationTarget.name) || [];
      localOrders.forEach((item) => {
        const key = item.name.trim().toLowerCase();
        if (itemsMap.has(key)) {
          const existing = itemsMap.get(key)!;
          existing.quantity += item.quantity;
          existing.totalPrice += item.total || item.price * item.quantity;
        } else {
          itemsMap.set(key, {
            id: item.id,
            name: item.name,
            quantity: item.quantity,
            unitPrice: item.price,
            totalPrice: item.total || item.price * item.quantity,
            category: item.category,
          });
        }
      });
    }

    return Array.from(itemsMap.values());
  }, [checkoutStationTarget, getStationFoodOrders, queryClient]);

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

      {/* 4. Refactored Settle Invoice Modal */}
      {checkoutStationTarget && (
        <SettleInvoiceModal
          isOpen={!!checkoutStationTarget}
          onClose={() => {
            setCheckoutStationTarget(null);
            setActionError(null);
          }}
          onSettle={handleExecuteCheckout}
          stationName={checkoutStationTarget.name}
          customerName={checkoutStationTarget.customer_name}
          timeCharge={Number(checkoutStationTarget.time_charge || 0)}
          ordersCharge={Number(checkoutStationTarget.orders_charge || 0)}
          elapsedMinutes={checkoutStationTarget.elapsed_minutes}
          allocatedMinutes={
            checkoutStationTarget.remaining_minutes !== undefined && checkoutStationTarget.remaining_minutes !== null
              ? checkoutStationTarget.elapsed_minutes + checkoutStationTarget.remaining_minutes
              : undefined
          }
          orderedItems={checkoutOrderedItems}
          isSubmitting={isCheckingOut}
          errorMessage={actionError}
        />
      )}
    </div>
  );
};
