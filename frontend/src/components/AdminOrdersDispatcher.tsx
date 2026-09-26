import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BellRing,
  Volume2,
  VolumeX,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Check,
  Ban,
  ShoppingBag,
  Zap,
  History,
} from 'lucide-react';
import { Order, OrderStatus, MenuItem, KitchenOrder, StationLive } from '../types';
import {
  fetchKitchenOrders,
  updateKitchenOrderStatus,
  fetchAdminMenuItems,
  fetchLiveStations,
} from '../api';
import { useCafeWebSocket } from '../hooks/useCafeWebSocket';
import {
  initAudioOnUserGesture,
  playOrderChime,
  isAudioMuted,
  setAudioMuted,
} from '../utils/soundAlerts';
import { useLoungeStore } from '../store/loungeStore';

interface GroupedServedSession {
  sessionId: string;
  stationName: string;
  customerName: string;
  isActive: boolean;
  items: {
    name: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
  }[];
  totalAmount: number;
  lastOrderTime: string;
}

export const AdminOrdersDispatcher: React.FC = () => {
  const queryClient = useQueryClient();

  // Audio mute state
  const [muted, setMutedState] = useState<boolean>(() => isAudioMuted());
  // Out-of-Stock Guard Dialog State
  const [outOfStockModal, setOutOfStockModal] = useState<{
    order: Order;
    lowStockItems: { name: string; available: number; requested: number }[];
  } | null>(null);
  // Reject confirmation dialog
  const [rejectConfirmModal, setRejectConfirmModal] = useState<Order | null>(null);
  // Toggle to view past completed sessions if needed
  const [showPastSessions, setShowPastSessions] = useState(false);

  // Initialize browser audio unlock listener
  useEffect(() => {
    initAudioOnUserGesture();
  }, []);

  const handleToggleMute = () => {
    const next = !muted;
    setMutedState(next);
    setAudioMuted(next);
  };

  const handleTestChime = () => {
    playOrderChime();
  };

  // Fetch kitchen orders directly from database
  const {
    data: rawOrders = [],
    refetch: refetchOrders,
  } = useQuery<Order[]>({
    queryKey: ['kitchen-orders'],
    queryFn: fetchKitchenOrders,
    refetchInterval: 5000,
  });

  // Fetch live stations to check which sessions are currently active
  const { data: liveStations = [] } = useQuery<StationLive[]>({
    queryKey: ['stations-live'],
    queryFn: fetchLiveStations,
    refetchInterval: 5000,
  });

  // Build a set of currently active session IDs
  const activeSessionIds = useMemo(() => {
    const set = new Set<string>();
    if (Array.isArray(liveStations)) {
      for (const st of liveStations) {
        if (st.active_session_id) {
          set.add(st.active_session_id);
        }
      }
    }
    return set;
  }, [liveStations]);

  // Fetch admin menu items for inventory stock comparison
  const { data: menuItems = [] } = useQuery<MenuItem[]>({
    queryKey: ['admin-menu'],
    queryFn: fetchAdminMenuItems,
    refetchInterval: 8000,
  });

  // Build a quick lookup map of menu item stock
  const stockMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of menuItems) {
      map.set(item.id, item.stock ?? 50);
      map.set(item.name.toLowerCase().trim(), item.stock ?? 50);
    }
    return map;
  }, [menuItems]);

  // Track previously alerted pending order IDs to prevent duplicate chimes on re-renders/tab navigation
  const seenPendingIdsRef = useRef<Set<string>>(new Set());
  const isInitialLoadRef = useRef(true);

  // Status progression mutation
  const statusMutation = useMutation({
    mutationFn: ({ orderId, status }: { orderId: string; status: OrderStatus }) =>
      updateKitchenOrderStatus(orderId, status),
    onSuccess: (_data, variables) => {
      const lounge = useLoungeStore.getState();
      if (variables.status === 'CANCELLED') {
        lounge.removeInSeatOrder(variables.orderId);
      } else {
        lounge.updateInSeatOrderStatus(variables.orderId, variables.status);
      }
      queryClient.invalidateQueries({ queryKey: ['kitchen-orders'] });
      queryClient.invalidateQueries({ queryKey: ['station-matrix'] });
      queryClient.invalidateQueries({ queryKey: ['stations-live'] });
      queryClient.invalidateQueries({ queryKey: ['admin-menu'] });
    },
  });

  // Check for newly arriving pending orders to trigger audio chime
  useEffect(() => {
    if (!Array.isArray(rawOrders)) return;

    const currentPendingOrders = rawOrders.filter(
      (o) => o.status === 'QUEUED' || (o.status as any) === 'pending'
    );

    if (isInitialLoadRef.current) {
      currentPendingOrders.forEach((o) => seenPendingIdsRef.current.add(o.id));
      isInitialLoadRef.current = false;
      return;
    }

    let hasNewPending = false;
    for (const order of currentPendingOrders) {
      if (!seenPendingIdsRef.current.has(order.id)) {
        seenPendingIdsRef.current.add(order.id);
        hasNewPending = true;
      }
    }

    if (hasNewPending) {
      playOrderChime();
    }
  }, [rawOrders]);

  // Listen to WebSocket events for instant real-time updates across sessions and orders
  useCafeWebSocket({
    channel: 'admin',
    onEvent: (event) => {
      if (event.event_type === 'ORDER_CREATED') {
        refetchOrders();
        queryClient.refetchQueries({ queryKey: ['kitchen-orders'] });
        queryClient.refetchQueries({ queryKey: ['stations-live'] });
        queryClient.refetchQueries({ queryKey: ['station-matrix'] });
      } else if (
        event.event_type === 'ORDER_STATUS_CHANGED' ||
        event.event_type === 'SESSION_UPDATED' ||
        event.event_type === 'SESSION_STARTED' ||
        event.event_type === 'SESSION_COMPLETED' ||
        event.event_type === 'SESSION_TRANSFERRED' ||
        event.event_type === 'SESSION_CANCELLED' ||
        event.event_type === 'STATION_LOCKED'
      ) {
        refetchOrders();
        queryClient.refetchQueries({ queryKey: ['kitchen-orders'] });
        queryClient.refetchQueries({ queryKey: ['stations-live'] });
        queryClient.refetchQueries({ queryKey: ['admin-menu'] });
      }
    },
  });

  // Format relative timestamp helper
  const getRelativeTime = (isoString?: string) => {
    if (!isoString) return 'Just now';
    try {
      const now = Date.now();
      const past = new Date(isoString).getTime();
      const diffSec = Math.max(0, Math.floor((now - past) / 1000));
      if (diffSec < 45) return 'Just now';
      if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
      return `${Math.floor(diffSec / 3600)}h ago`;
    } catch {
      return 'Just now';
    }
  };

  // Convert raw Order to normalized tickets for incoming pending lane
  const pendingOrders = useMemo(() => {
    if (!Array.isArray(rawOrders)) return [];
    const list = rawOrders
      .filter((o) => o.status === 'QUEUED' || (o.status as any) === 'pending')
      .map((o): KitchenOrder => {
        const items = (o.items || []).map((itm) => ({
          itemId: itm.menu_item_id || itm.id,
          name: itm.menu_item_name || 'Item',
          quantity: itm.quantity || 1,
          unitPrice: Number(itm.unit_price) || 0,
          subtotal: Number(itm.subtotal) || (Number(itm.unit_price) || 0) * (itm.quantity || 1),
        }));

        return {
          id: o.id,
          stationId: (o as any).station_id || o.session_id || 'station',
          stationName: o.station_name || 'Gaming Desk',
          customerName: o.customer_name || 'Guest Gamer',
          createdAt: o.created_at,
          status: 'pending',
          items,
          totalAmount: Number(o.total_amount) || 0,
          rawOrder: o,
        };
      });

    return list;
  }, [rawOrders]);

  // =========================================================================
  // GROUPED COMPLETED / SERVED SESSIONS LOGIC:
  // Groups multiple orders placed during the SAME session into a SINGLE box.
  // When a user visits for a new session, it appears in a separate box.
  // =========================================================================
  const { activeServedSessions, pastServedSessions } = useMemo(() => {
    if (!Array.isArray(rawOrders)) return { activeServedSessions: [], pastServedSessions: [] };

    const servedOrders = rawOrders.filter(
      (o) => o.status === 'SERVED' || o.status === 'PREPARING'
    );

    const sessionMap = new Map<string, GroupedServedSession>();

    for (const order of servedOrders) {
      const sessionId = order.session_id || order.id;
      const existing = sessionMap.get(sessionId);
      const stationName = order.station_name || 'Station';
      const customerName = order.customer_name || 'Gamer';
      const orderTotal = Number(order.total_amount) || 0;
      const isSessionActive = activeSessionIds.has(sessionId);

      if (!existing) {
        const itemMap = new Map<string, { name: string; quantity: number; unitPrice: number; subtotal: number }>();
        for (const itm of order.items || []) {
          const name = itm.menu_item_name || 'Item';
          const qty = itm.quantity || 1;
          const uPrice = Number(itm.unit_price) || 0;
          const sub = Number(itm.subtotal) || uPrice * qty;

          const prev = itemMap.get(name);
          if (prev) {
            prev.quantity += qty;
            prev.subtotal += sub;
          } else {
            itemMap.set(name, { name, quantity: qty, unitPrice: uPrice, subtotal: sub });
          }
        }

        sessionMap.set(sessionId, {
          sessionId,
          stationName,
          customerName,
          isActive: isSessionActive,
          items: Array.from(itemMap.values()),
          totalAmount: orderTotal,
          lastOrderTime: order.created_at,
        });
      } else {
        // Merge into the same session box
        existing.totalAmount += orderTotal;
        if (new Date(order.created_at) > new Date(existing.lastOrderTime)) {
          existing.lastOrderTime = order.created_at;
        }
        for (const itm of order.items || []) {
          const name = itm.menu_item_name || 'Item';
          const qty = itm.quantity || 1;
          const uPrice = Number(itm.unit_price) || 0;
          const sub = Number(itm.subtotal) || uPrice * qty;

          const existingItem = existing.items.find((i) => i.name === name);
          if (existingItem) {
            existingItem.quantity += qty;
            existingItem.subtotal += sub;
          } else {
            existing.items.push({ name, quantity: qty, unitPrice: uPrice, subtotal: sub });
          }
        }
      }
    }

    const allSessions = Array.from(sessionMap.values());

    const activeList = allSessions
      .filter((s) => s.isActive)
      .sort((a, b) => new Date(b.lastOrderTime).getTime() - new Date(a.lastOrderTime).getTime());

    const pastList = allSessions
      .filter((s) => !s.isActive)
      .sort((a, b) => new Date(b.lastOrderTime).getTime() - new Date(a.lastOrderTime).getTime());

    return { activeServedSessions: activeList, pastServedSessions: pastList };
  }, [rawOrders, activeSessionIds]);

  // Accept handler with Out-of-Stock Guard
  const handleAcceptClick = (order: Order) => {
    const lowStockItems: { name: string; available: number; requested: number }[] = [];

    for (const item of order.items || []) {
      const itemId = item.menu_item_id;
      const itemName = item.menu_item_name || 'Item';
      const available = stockMap.get(itemId) ?? stockMap.get(itemName.toLowerCase().trim()) ?? 99;

      if (available < item.quantity) {
        lowStockItems.push({
          name: itemName,
          available,
          requested: item.quantity,
        });
      }
    }

    if (lowStockItems.length > 0) {
      setOutOfStockModal({ order, lowStockItems });
    } else {
      executeAccept(order);
    }
  };

  // When staff accepts, the order directly transitions to SERVED (Completed / Served)
  const executeAccept = (order: Order) => {
    setOutOfStockModal(null);
    statusMutation.mutate({ orderId: order.id, status: 'SERVED' });
  };

  // Reject handler
  const handleRejectClick = (order: Order) => {
    setRejectConfirmModal(order);
  };

  const executeReject = (order: Order) => {
    setRejectConfirmModal(null);
    statusMutation.mutate({ orderId: order.id, status: 'CANCELLED' });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* ========================================================================= */}
      {/* HEADER DISPATCH TOOLBAR (SUBTITLE TEXT REMOVED) */}
      {/* ========================================================================= */}
      <div className="bg-slate-900/90 border border-slate-800/90 rounded-2xl p-4 sm:p-5 backdrop-blur-xl shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="relative p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
            <BellRing className={`w-6 h-6 ${pendingOrders.length > 0 ? 'animate-bounce' : ''}`} />
            {pendingOrders.length > 0 && (
              <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-amber-500 rounded-full animate-ping" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-lg sm:text-xl font-black text-white font-display uppercase tracking-wide">
                Live Orders Dispatch
              </h2>
              {pendingOrders.length > 0 ? (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-mono-code font-bold bg-amber-500/20 text-amber-300 border border-amber-500 animate-pulse-border">
                  {pendingOrders.length} Pending
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-mono-code text-slate-400 bg-slate-800/60 border border-slate-700/60">
                  All Clear
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Toolbar Controls (Sound Alert & Test Chime) */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Sound Alert Toggle */}
          <button
            onClick={handleToggleMute}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${muted
                ? 'bg-rose-950/40 border-rose-800/60 text-rose-300 hover:bg-rose-900/50'
                : 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300 hover:bg-emerald-900/50'
              }`}
            title={muted ? 'Unmute Audio Alerts' : 'Mute Audio Alerts'}
          >
            {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            <span>{muted ? 'Alerts Muted' : 'Sound ON'}</span>
          </button>

          {/* Test Chime */}
          <button
            onClick={handleTestChime}
            className="px-3 py-1.5 rounded-xl text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700/70 transition-all cursor-pointer"
            title="Test Two-Tone Cafe Chime"
          >
            Test Chime
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2-COLUMN ORDER DISPATCH LAYOUT */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* ======================================================================= */}
        {/* COLUMN 1: INCOMING ORDERS AWAITING ACTION */}
        {/* ======================================================================= */}
        <div className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
              <h3 className="text-sm font-black text-amber-400 font-display uppercase tracking-wider">
                Incoming Orders Awaiting Action
              </h3>
            </div>
            <span className="px-2.5 py-0.5 rounded-lg text-xs font-mono-code font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
              {pendingOrders.length}
            </span>
          </div>

          {pendingOrders.length === 0 ? (
            <div className="bg-slate-900/50 border border-slate-800/80 rounded-2xl p-8 text-center backdrop-blur-sm">
              <CheckCircle2 className="w-10 h-10 text-emerald-400/60 mx-auto mb-2.5" />
              <h4 className="text-sm font-bold text-slate-200">No Pending Orders</h4>
              <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
                All customer orders have been acknowledged. New station orders will chime automatically.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {pendingOrders.map((ticket) => {
                const rawOrder = ticket.rawOrder!;
                return (
                  <div
                    key={ticket.id}
                    className="relative bg-slate-950/90 rounded-2xl border-2 border-amber-500 p-4 sm:p-5 animate-pulse-border hover:border-amber-400"
                  >
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2 border-b border-slate-800/80 pb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="px-2.5 py-1 rounded-lg text-xs font-bold font-display uppercase tracking-wider bg-blue-500/20 text-blue-300 border border-blue-500/30">
                            {ticket.stationName}
                          </span>
                          <span className="text-xs font-bold text-slate-300">
                            {ticket.customerName}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] text-amber-400/90 font-mono-code mt-1.5">
                          <Clock className="w-3 h-3" />
                          <span>Placed {getRelativeTime(ticket.createdAt as string)}</span>
                        </div>
                      </div>

                      <div className="text-right">
                        <span className="text-xs font-medium text-slate-400 block">Total Bill</span>
                        <span className="text-lg font-black text-white font-mono-code">
                          ₹{ticket.totalAmount.toFixed(2)}
                        </span>
                      </div>
                    </div>

                    {/* Itemized Body */}
                    <div className="py-3 space-y-2">
                      <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider font-display">
                        Order Items
                      </p>
                      <div className="space-y-1.5">
                        {ticket.items.map((it, idx) => {
                          const stock = stockMap.get(it.itemId) ?? stockMap.get(it.name.toLowerCase().trim()) ?? 99;
                          const isLowStock = stock < it.quantity;

                          return (
                            <div
                              key={idx}
                              className="flex items-center justify-between text-xs py-1.5 px-3 rounded-lg bg-slate-900/80 border border-slate-800/60"
                            >
                              <div className="flex items-center gap-2">
                                <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono-code font-bold text-[11px]">
                                  x{it.quantity}
                                </span>
                                <span className="font-medium text-slate-200">{it.name}</span>
                                {isLowStock && (
                                  <span className="px-1.5 py-0.2 rounded text-[10px] font-mono-code bg-rose-500/20 text-rose-300 border border-rose-500/30 flex items-center gap-0.5">
                                    <AlertTriangle className="w-2.5 h-2.5" /> Stock: {stock}
                                  </span>
                                )}
                              </div>
                              <span className="font-mono-code text-slate-300">
                                ₹{(it.subtotal || it.unitPrice * it.quantity).toFixed(2)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Action Controls */}
                    <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-3">
                      {/* Reject Button (Red Outline) */}
                      <button
                        onClick={() => handleRejectClick(rawOrder)}
                        disabled={statusMutation.isPending}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl border border-rose-500/60 text-rose-300 hover:bg-rose-950/50 hover:border-rose-400 text-xs font-bold font-display uppercase tracking-wider transition-all cursor-pointer active:scale-98"
                      >
                        <Ban className="w-3.5 h-3.5" />
                        <span>Reject Order</span>
                      </button>

                      {/* Accept Button (Green Solid) - Directly moves to Completed / Served */}
                      <button
                        onClick={() => handleAcceptClick(rawOrder)}
                        disabled={statusMutation.isPending}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-black text-xs font-display uppercase tracking-wider shadow-[0_0_15px_rgba(16,185,129,0.35)] transition-all cursor-pointer active:scale-98"
                      >
                        <Check className="w-4 h-4 stroke-[3]" />
                        <span>Accept & Complete</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ======================================================================= */}
        {/* COLUMN 2: REMADE COMPLETED / SERVED ORDERS SECTION */}
        {/* Compact, minimal space consumption, aggregated per active session */}
        {/* ======================================================================= */}
        <div className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
              <h3 className="text-sm font-black text-emerald-400 font-display uppercase tracking-wider">
                Completed / Served Orders
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowPastSessions(!showPastSessions)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold font-display uppercase tracking-wider transition-all border cursor-pointer ${showPastSessions
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-sm'
                    : 'bg-slate-800/90 hover:bg-slate-700 text-slate-200 border-slate-700/80 shadow-sm hover:border-slate-600'
                  }`}
                title="View Past Session Orders History"
              >
                <History className="w-3.5 h-3.5 text-slate-400" />
                <span>{showPastSessions ? 'Hide History' : `History (${pastServedSessions.length})`}</span>
              </button>
            </div>
          </div>

          {/* If no active sessions have served orders */}
          {activeServedSessions.length === 0 && (!showPastSessions || pastServedSessions.length === 0) ? (
            <div className="bg-slate-900/50 border border-slate-800/80 rounded-2xl p-8 text-center backdrop-blur-sm">
              <ShoppingBag className="w-10 h-10 text-slate-500/60 mx-auto mb-2.5" />
              <h4 className="text-sm font-bold text-slate-300">No Active Served Orders</h4>
              <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
                When incoming orders are accepted, they will be cleanly grouped here by active station session.
              </p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[750px] overflow-y-auto pr-1">
              {/* Active Sessions List */}
              {activeServedSessions.map((session) => (
                <div
                  key={session.sessionId}
                  className="bg-slate-950/80 rounded-xl border border-emerald-500/35 p-3.5 shadow-md hover:border-emerald-500/60 transition-all space-y-2.5"
                >
                  {/* Compact Header: Station Name & User Name */}
                  <div className="flex items-center justify-between gap-2 border-b border-slate-800/70 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-md text-xs font-bold font-mono-code bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        {session.stationName}
                      </span>
                      <span className="text-xs font-bold text-slate-200 truncate max-w-[140px] sm:max-w-[180px]">
                        {session.customerName}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono-code font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                        <Zap className="w-2.5 h-2.5" /> Active Session
                      </span>
                      <span className="text-xs font-black text-white font-mono-code">
                        ₹{session.totalAmount.toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {/* Compact Items & Price List (Aggregated for this session) */}
                  <div className="space-y-1 text-xs">
                    {session.items.map((it, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between py-0.5 px-2 rounded bg-slate-900/50 text-slate-300"
                      >
                        <div className="flex items-center gap-1.5 truncate">
                          <span className="font-mono-code text-emerald-400 font-bold text-[11px]">
                            x{it.quantity}
                          </span>
                          <span className="truncate">{it.name}</span>
                        </div>
                        <span className="font-mono-code text-slate-300 shrink-0 ml-2">
                          ₹{it.subtotal.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {/* Past / Ended Sessions (Only displayed if staff toggles 'Show Past') */}
              {showPastSessions && pastServedSessions.length > 0 && (
                <div className="pt-2 border-t border-slate-800 space-y-2">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider px-1">
                    Past Completed Sessions
                  </span>
                  {pastServedSessions.map((session) => (
                    <div
                      key={session.sessionId}
                      className="bg-slate-950/50 rounded-xl border border-slate-800/80 p-3 space-y-2 opacity-80 hover:opacity-100 transition-opacity"
                    >
                      <div className="flex items-center justify-between text-xs border-b border-slate-800/60 pb-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="px-1.5 py-0.5 rounded text-[11px] font-mono-code bg-slate-800 text-slate-300">
                            {session.stationName}
                          </span>
                          <span className="font-medium text-slate-300">{session.customerName}</span>
                        </div>
                        <span className="font-mono-code font-bold text-slate-300">
                          ₹{session.totalAmount.toFixed(2)}
                        </span>
                      </div>

                      <div className="space-y-0.5 text-xs text-slate-400">
                        {session.items.map((it, idx) => (
                          <div key={idx} className="flex justify-between px-1">
                            <span>x{it.quantity} {it.name}</span>
                            <span className="font-mono-code">₹{it.subtotal.toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* OUT-OF-STOCK WARNING MODAL */}
      {/* ========================================================================= */}
      {outOfStockModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-amber-500/50 rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-400">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white font-display uppercase tracking-wide">
                  Low Inventory Warning
                </h3>
                <p className="text-xs text-slate-400">
                  Some items in this order exceed current stock levels
                </p>
              </div>
            </div>

            <div className="bg-slate-950/80 rounded-xl border border-slate-800 p-3 space-y-2">
              <p className="text-xs font-semibold text-slate-300">Stock shortfall details:</p>
              {outOfStockModal.lowStockItems.map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between text-xs py-1 px-2 rounded bg-amber-950/30 border border-amber-800/40 text-amber-200"
                >
                  <span className="font-medium">{item.name}</span>
                  <span className="font-mono-code text-[11px]">
                    Available: <b className="text-rose-400">{item.available}</b> | Ordered: <b>{item.requested}</b>
                  </span>
                </div>
              ))}
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Accepting this order will decrement stock to 0 and mark the order as Completed/Served. Do you wish to continue?
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800">
              <button
                onClick={() => setOutOfStockModal(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => executeAccept(outOfStockModal.order)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-400 text-black transition-colors cursor-pointer"
              >
                Accept Anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* REJECT CONFIRMATION MODAL */}
      {/* ========================================================================= */}
      {rejectConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-rose-500/50 rounded-2xl max-w-sm w-full p-5 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-rose-500/20 text-rose-400">
                <XCircle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white font-display uppercase tracking-wide">
                  Reject Order?
                </h3>
                <p className="text-xs text-slate-400">
                  {rejectConfirmModal.station_name || 'Desk'} ({rejectConfirmModal.customer_name || 'Guest'})
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Are you sure you want to reject this order? This will cancel the ticket, notify the customer on their screen, and avoid charging their station tab.
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800">
              <button
                onClick={() => setRejectConfirmModal(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
              >
                Keep Order
              </button>
              <button
                onClick={() => executeReject(rejectConfirmModal)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white transition-colors cursor-pointer"
              >
                Confirm Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
