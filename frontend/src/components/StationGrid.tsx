import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Monitor,
  ArrowRightLeft,
  AlertCircle,
  XCircle,
  Users,
  SlidersHorizontal,
  Gamepad2,
  CalendarClock,
} from 'lucide-react';
import { StationLive, PricingTier, MatrixSession, StationMatrixData, Order } from '../types';
import { POLL_INTERVALS } from '../constants';
import {
  fetchLiveStations,
  fetchStationMatrix,
  transferStation,
  checkoutSession,
  fetchAdvanceBookingsApi,
} from '../api';
import { sortBookingsUpcomingWise } from '../utils/bookingConflict';
import { useLoungeStore } from '../store/loungeStore';
import { useNotificationStore } from '../store/notificationStore';
import { useAuthStore } from '../store/authStore';
import { SessionUpsellDrawer } from './SessionUpsellDrawer';
import { StationFoodOrderModal } from './StationFoodOrderModal';
import { CustomerLogs } from './CustomerLogs';
import { ManageStation } from './ManageStation';
import { ConsoleMatrixDashboard } from './ConsoleMatrixDashboard';
import { AdvanceBookingsManager } from './AdvanceBookingsManager';
import { SettleInvoiceModal, SettleInvoicePayload, OrderedReceiptItem } from './SettleInvoiceModal';

export type StationSubTab = 'stations' | 'customer_logs' | 'manage_station' | 'advance_bookings';

export const StationGrid: React.FC = () => {
  const queryClient = useQueryClient();
  const { addNotification } = useNotificationStore();
  const {
    clearStationFoodOrders,
    getStationFoodOrders,
    recordTransaction,
    completeActiveBookingForStation,
    bookings,
  } = useLoungeStore();

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
  const [checkoutDirectItems, setCheckoutDirectItems] = useState<OrderedReceiptItem[] | null>(null);
  const [isCheckingOut, setIsCheckingOut] = useState(false);

  // Station Matrix Query for column availability & active sessions
  const { data: matrixData } = useQuery<StationMatrixData>({
    queryKey: ['station-matrix'],
    queryFn: fetchStationMatrix,
    refetchInterval: POLL_INTERVALS.STATIONS,
  });

  // Advance Bookings Query to keep Station Matrix & collision detection always up to date across browser refreshes
  const { data: serverBookings = [] } = useQuery<any[]>({
    queryKey: ['advance-bookings'],
    queryFn: fetchAdvanceBookingsApi,
    refetchInterval: 3000,
  });

  useEffect(() => {
    if (Array.isArray(serverBookings) && serverBookings.length > 0) {
      const current = useLoungeStore.getState().bookings;
      const map = new Map<string, any>();
      current.forEach((b) => map.set(String(b.bookingId || b.id), b));
      serverBookings.forEach((sb) => map.set(String(sb.bookingId || sb.id), sb));
      useLoungeStore.setState({ bookings: sortBookingsUpcomingWise(Array.from(map.values())) });
    }
  }, [serverBookings]);

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

  // Auto-complete active advance bookings when their station session is ended
  useEffect(() => {
    if (!matrixData?.stations) return;
    const activeBookings = bookings.filter((b) => b.status === 'ACTIVE');
    for (const b of activeBookings) {
      const st = matrixData.stations.find(
        (s) => (s.name || s.id || '').toUpperCase() === (b.stationId || '').toUpperCase()
      );
      if (st && st.status !== 'OCCUPIED' && !st.active_session) {
        completeActiveBookingForStation(b.stationId);
      }
    }
  }, [matrixData?.stations, bookings, completeActiveBookingForStation]);

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
      const isCafe = checkoutStationTarget.name.toUpperCase().includes('CAFE');

      if (!targetSessionId || targetSessionId.startsWith('cafe-walkin')) {
        if (isCafe) {
          const targetCust = (checkoutStationTarget.customer_name || '').trim().toLowerCase();
          const matchedCafe = (matrixData?.cafe_sessions || []).find(
            (cs) => cs.session_id === targetSessionId ||
            (targetCust && (cs.customer_name || '').trim().toLowerCase() === targetCust)
          );
          if (matchedCafe?.session_id) {
            targetSessionId = matchedCafe.session_id;
          } else if (matrixData?.cafe_session?.session_id) {
            targetSessionId = matrixData.cafe_session.session_id;
          } else {
            // Also check kitchen-orders cache for matching session_id
            const koList = queryClient.getQueryData<Order[]>(['kitchen-orders']) || [];
            const koMatch = koList.find(
              (ko) => ko.session_id &&
              targetCust &&
              (ko.customer_name || '').trim().toLowerCase() === targetCust
            );
            if (koMatch?.session_id) {
              targetSessionId = String(koMatch.session_id);
            }
          }
        } else {
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
      }

      let apiRes: any = null;
      if (targetSessionId && !targetSessionId.startsWith('cafe-walkin')) {
        try {
          // Call backend with payment method, discount percent, and flat discount amount
          apiRes = await checkoutSession(
            targetSessionId,
            payload.paymentMethod,
            payload.discountPercent,
            payload.discountAmount
          );
        } catch (checkoutErr: any) {
          const errText = String(checkoutErr?.message || '').toLowerCase();
          if (errText.includes('already closed') || errText.includes('not found')) {
            // Already closed on backend - proceed to purge local and reactive state
          } else {
            throw checkoutErr;
          }
        }
      }

      // Record offline transaction ledger entry for lounge analytics
      recordTransaction({
        stationName: payload.stationName,
        customerName: checkoutStationTarget.customer_name || (isCafe ? 'Walk-in Cafe Guest' : 'Walk-in Gamer'),
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
      useLoungeStore.getState().clearStationInSeatOrders(checkoutStationTarget.name);
      if (isCafe) {
        clearStationFoodOrders('Walk-in CAFE');
        const custNorm = (checkoutStationTarget.customer_name || '').trim().toLowerCase();
        useLoungeStore.getState().clearStationInSeatOrders('Walk-in CAFE', checkoutStationTarget.customer_name || undefined);
        if (custNorm) {
          useLoungeStore.getState().settleCafeCustomer(checkoutStationTarget.customer_name || '');
        }
        // Purge immediately from kitchen-orders cache so Walk-in CAFE displays empty immediately
        queryClient.setQueryData<Order[]>(['kitchen-orders'], (old) =>
          (old || []).filter((ko) => {
            if (targetSessionId && String(ko.session_id) === String(targetSessionId)) return false;
            if (custNorm && (ko.customer_name || '').trim().toLowerCase() === custNorm) return false;
            return true;
          })
        );
      }
      completeActiveBookingForStation(checkoutStationTarget.name);
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['station-matrix'] }),
        queryClient.refetchQueries({ queryKey: ['stations-live'] }),
        queryClient.refetchQueries({ queryKey: ['customer-sessions'] }),
        queryClient.refetchQueries({ queryKey: ['kitchen-orders'] }),
        queryClient.refetchQueries({ queryKey: ['admin-customers'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-revenue-analytics'] }),
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
    const isCafe = stationName.toUpperCase().includes('CAFE') || session.station_id?.toUpperCase().includes('CAFE');
    const matched = safeStations.find(
      (s) => s.id === session.station_id || s.name.toUpperCase() === stationName.toUpperCase()
    );
    setFoodOrderStation(
      matched
        ? {
            ...matched,
            active_session_id: session.session_id,
            name: stationName || matched.name,
            customer_name: session.customer_name || matched.customer_name,
            tier: (isCafe ? 'CAFE' : matched.tier) as any,
          }
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

  const handleMatrixCheckout = (
    session: MatrixSession,
    stationName: string,
    directItems?: OrderedReceiptItem[]
  ) => {
    setCheckoutDirectItems(directItems && directItems.length > 0 ? directItems : null);
    const isCafe = stationName.toUpperCase().includes('CAFE') || session.station_id?.toUpperCase().includes('CAFE');
    const matched = !isCafe
      ? safeStations.find(
          (s) => s.id === session.station_id || s.name.toUpperCase() === stationName.toUpperCase()
        )
      : null;
    setCheckoutStationTarget(
      matched || ({
        id: session.station_id || session.session_id,
        name: stationName,
        tier: (isCafe ? 'CAFE' : 'CONSOLE') as any,
        hourly_rate: session.hourly_rate || 0,
        status: 'OCCUPIED',
        is_occupied: true,
        active_session_id: session.session_id,
        time_charge: session.time_charge || 0,
        orders_charge: session.orders_charge,
        running_total: session.running_total,
        elapsed_minutes: session.elapsed_minutes || 0,
        remaining_minutes: session.remaining_minutes || 0,
        active_orders_count: session.active_orders_count || 0,
        customer_name: session.customer_name,
        customer_phone: session.customer_phone,
      } as StationLive)
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

  // Itemized food receipt list: strictly gathers real orders for accurate settlement invoice display.
  const checkoutOrderedItems = useMemo<OrderedReceiptItem[]>(() => {
    if (!checkoutStationTarget) return [];

    const isCafe = checkoutStationTarget.name.toUpperCase().includes('CAFE') ||
                   checkoutStationTarget.name.toUpperCase().includes('WALK');
    const targetCust = checkoutStationTarget.customer_name?.trim().toLowerCase();
    const itemsMap = new Map<string, OrderedReceiptItem>();

    // 0. Direct items passed from active customer selection in Walk-in CAFE
    if (checkoutDirectItems && checkoutDirectItems.length > 0) {
      checkoutDirectItems.forEach((item) => {
        const key = item.name.trim().toLowerCase();
        const uPrice = Number(item.unitPrice) || 0;
        const qty = Number(item.quantity) || 1;
        const sTotal = Number(item.totalPrice) || uPrice * qty;
        if (itemsMap.has(key)) {
          const existing = itemsMap.get(key)!;
          existing.quantity += qty;
          existing.totalPrice += sTotal;
        } else {
          itemsMap.set(key, {
            id: item.id,
            name: item.name,
            quantity: qty,
            unitPrice: uPrice,
            totalPrice: sTotal,
            category: item.category,
          });
        }
      });
    }

    // 1. Primary ground-truth: Kitchen orders from database cache (only if direct items were not provided)
    if (itemsMap.size === 0) {
      const kitchenOrders = queryClient.getQueryData<Order[]>(['kitchen-orders']) || [];
      const allStationOrders = kitchenOrders.filter((o) => {
        const s = String(o.status).toUpperCase();
        if (s === 'CANCELLED' || s === 'REJECTED') return false;

        if (isCafe) {
          if (checkoutStationTarget.active_session_id && o.session_id === checkoutStationTarget.active_session_id) {
            return true;
          }
          if (targetCust && o.customer_name && o.customer_name.trim().toLowerCase() === targetCust) {
            return true;
          }
          if (o.station_name && (o.station_name.toUpperCase().includes('CAFE') || o.station_name.toUpperCase().includes('WALK'))) {
            if (!targetCust || targetCust === 'walk-in guest' || targetCust === 'walk-in cafe guest' || !o.customer_name) {
              return true;
            }
            if (o.customer_name.trim().toLowerCase() === targetCust) {
              return true;
            }
          }
          return false;
        }
        return (
          (checkoutStationTarget.active_session_id && o.session_id === checkoutStationTarget.active_session_id) ||
          (o.station_name && o.station_name.toUpperCase() === checkoutStationTarget.name.toUpperCase())
        );
      });

      if (allStationOrders.length > 0) {
        // For cafe/walkin, all non-cancelled orders are billable and auto-served at settlement
        const billableOrders = isCafe
          ? allStationOrders
          : allStationOrders.filter((o) => o.status === 'SERVED' || !['CANCELLED', 'REJECTED'].includes(String(o.status).toUpperCase()));

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
      }
    }

    // 2. Fallback: check in-seat orders from loungeStore for this specific customer
    if (itemsMap.size === 0) {
      const activeInSeat = useLoungeStore.getState().inSeatOrders.filter((o) => {
        const s = String(o.status).toLowerCase();
        if (s === 'cancelled' || s === 'rejected') return false;
        if (isCafe) {
          if (targetCust && targetCust !== 'walk-in guest' && targetCust !== 'walk-in cafe guest') {
            return o.customerName?.trim().toLowerCase() === targetCust;
          }
          return o.stationId?.toUpperCase().includes('CAFE') || o.stationId?.toUpperCase().includes('WALK');
        }
        return o.stationId?.toUpperCase() === checkoutStationTarget.name.toUpperCase();
      });

      activeInSeat.forEach((ord) => {
        (ord.items || []).forEach((item) => {
          const key = item.name.trim().toLowerCase();
          const uPrice = Number(item.price) || 0;
          const qty = Number(item.qty) || 1;
          const sTotal = uPrice * qty;
          if (itemsMap.has(key)) {
            const existing = itemsMap.get(key)!;
            existing.quantity += qty;
            existing.totalPrice += sTotal;
          } else {
            itemsMap.set(key, {
              id: item.id,
              name: item.name,
              quantity: qty,
              unitPrice: uPrice,
              totalPrice: sTotal,
            });
          }
        });
      });
    }

    // 3. Fallback to stationFoodOrders
    if (itemsMap.size === 0) {
      const localOrders = getStationFoodOrders(checkoutStationTarget.name) || 
                          (isCafe ? getStationFoodOrders('Walk-in CAFE') : []);
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
  }, [checkoutStationTarget, checkoutDirectItems, getStationFoodOrders, queryClient]);

  return (
    <div className="space-y-6 relative z-10">
      {/* 1. Sub-navigation Header Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[#E2E8F0]">
        <div>
          <div className="flex items-center gap-2.5">
            <Monitor className="w-6 h-6 text-[#172554]" />
            <h2 className="text-xl sm:text-2xl font-bold font-display text-[#172554] tracking-wide">
              Station Management & Operations
            </h2>
          </div>
          <p className="text-xs text-[#64748B] mt-1 font-sans">
            Console fleet operations, customer directory logs, and station configuration.
          </p>
        </div>

        {/* Sub-options Switcher: Console Stations, Customer Logs, Manage Station */}
        <div className="flex items-center bg-[#FFFFFF] p-1.5 rounded-2xl border border-[#E2E8F0] shadow-xs gap-1 flex-wrap self-start md:self-auto">
          <button
            onClick={() => setActiveSubTab('stations')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold font-display tracking-wider transition-all cursor-pointer ${
              activeSubTab === 'stations'
                ? 'bg-[#172554] text-[#FFFFFF] shadow-xs font-bold'
                : 'bg-[#FFFFFF] border border-[#E2E8F0] text-[#64748B] hover:text-[#0F172A]'
            }`}
          >
            <Gamepad2 className="w-4 h-4" />
            <span>Console Stations</span>
          </button>

          <button
            onClick={() => setActiveSubTab('customer_logs')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold font-display tracking-wider transition-all cursor-pointer ${
              activeSubTab === 'customer_logs'
                ? 'bg-[#172554] text-[#FFFFFF] shadow-xs font-bold'
                : 'bg-[#FFFFFF] border border-[#E2E8F0] text-[#64748B] hover:text-[#0F172A]'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Customer Logs</span>
          </button>

          <button
            onClick={() => setActiveSubTab('manage_station')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold font-display tracking-wider transition-all cursor-pointer ${
              activeSubTab === 'manage_station'
                ? 'bg-[#172554] text-[#FFFFFF] shadow-xs font-bold'
                : 'bg-[#FFFFFF] border border-[#E2E8F0] text-[#64748B] hover:text-[#0F172A]'
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" />
            <span>Manage Station</span>
          </button>

          <button
            onClick={() => setActiveSubTab('advance_bookings')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold font-display tracking-wider transition-all cursor-pointer ${
              activeSubTab === 'advance_bookings'
                ? 'bg-[#172554] text-[#FFFFFF] shadow-xs font-bold'
                : 'bg-[#FFFFFF] border border-[#E2E8F0] text-[#64748B] hover:text-[#0F172A]'
            }`}
          >
            <CalendarClock className="w-4 h-4 text-[#EA580C]" />
            <span>Advance Bookings</span>
          </button>
        </div>
      </div>

      {/* Global Error Banner */}
      {actionError && (
        <div className="p-3.5 rounded-xl bg-[#FEE2E2] border border-[#FECACA] text-[#B91C1C] flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-[#B91C1C] shrink-0" />
            <span>{actionError}</span>
          </div>
          <button onClick={() => setActionError(null)} className="text-[#B91C1C] hover:text-[#7F1D1D] p-1">
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
      {/* 4. SUB-OPTION VIEW 3: ADVANCE BOOKINGS */}
      {/* ========================================================================= */}
      {activeSubTab === 'advance_bookings' && (
        <AdvanceBookingsManager onSessionStarted={() => setActiveSubTab('stations')} />
      )}

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
        defaultCustomerName=""
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
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#FFFFFF] border border-[#E2E8F0] max-w-md w-full rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center pb-2 border-b border-[#E2E8F0]">
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="w-5 h-5 text-[#172554]" />
                <h3 className="font-bold text-[#172554] font-display">Transfer Active Session</h3>
              </div>
              <button
                onClick={() => setTransferStationTarget(null)}
                className="text-[#64748B] hover:text-[#0F172A]"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-[#64748B]">
              Moving player from <strong className="text-[#0F172A]">{transferStationTarget.name}</strong> to:
            </p>

            {transferOptions.length === 0 ? (
              <p className="text-xs text-[#B91C1C] bg-[#FEE2E2] p-3 rounded-xl border border-[#FECACA]">
                No available PS consoles (PS1, PS2, PS3) are free to receive transfer right now.
              </p>
            ) : (
              <select
                value={targetStationId}
                onChange={(e) => setTargetStationId(e.target.value)}
                className="w-full bg-[#FFF7ED] border border-[#E2E8F0] rounded-xl p-3 text-xs text-[#0F172A] focus:outline-none focus:border-[#EA580C]"
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
                className="flex-1 py-2.5 bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#64748B] border border-[#E2E8F0] rounded-xl text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                disabled={!targetStationId || transferMutation.isPending}
                onClick={() => transferMutation.mutate()}
                className="flex-1 py-2.5 bg-[#172554] hover:bg-[#1E3A8A] text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50 cursor-pointer shadow-sm"
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
            setCheckoutDirectItems(null);
            setActionError(null);
          }}
          onSettle={handleExecuteCheckout}
          stationName={checkoutStationTarget.name}
          customerName={checkoutStationTarget.customer_name}
          customerPhone={checkoutStationTarget.customer_phone}
          timeCharge={Number(checkoutStationTarget.time_charge || 0)}
          ordersCharge={Number(checkoutStationTarget.orders_charge || 0)}
          elapsedMinutes={checkoutStationTarget.elapsed_minutes}
          allocatedMinutes={
            checkoutStationTarget.remaining_minutes !== undefined && checkoutStationTarget.remaining_minutes !== null
              ? checkoutStationTarget.elapsed_minutes + checkoutStationTarget.remaining_minutes
              : undefined
          }
          orderedItems={checkoutOrderedItems}
          isWalkin={
            checkoutStationTarget.name.toUpperCase().includes('CAFE') ||
            checkoutStationTarget.name.toUpperCase().includes('WALK') ||
            (checkoutStationTarget.tier as string) === 'CAFE'
          }
          isSubmitting={isCheckingOut}
          errorMessage={actionError}
        />
      )}
    </div>
  );
};
