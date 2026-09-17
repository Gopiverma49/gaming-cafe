import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Minus,
  CheckCircle2,
  Utensils,
  ChevronRight,
  Sparkles,
  AlertTriangle,
  X,
} from 'lucide-react';
import { CustomerDeskSession, MenuItem } from '../types';
import {
  fetchDeskSession,
  fetchMenuItems,
  placeCustomerOrder,
  getCustomerToken,
} from '../api';
import { useCafeWebSocket } from '../hooks/useCafeWebSocket';

interface CustomerHUDProps {
  initialDeskId?: string;
  initialSessionId?: string;
  onBackToMatrix?: () => void;
}

export const CustomerHUD: React.FC<CustomerHUDProps> = ({
  initialDeskId,
  initialSessionId,
  onBackToMatrix,
}) => {
  const queryClient = useQueryClient();

  const [deskToken, setDeskToken] = useState<string | null>(null);
  const [isMenuDrawerOpen, setIsMenuDrawerOpen] = useState(false);
  const [cart, setCart] = useState<Record<string, number>>({}); // itemId -> qty
  const [orderSuccessMessage, setOrderSuccessMessage] = useState<string | null>(null);

  // Authenticate desk session
  useEffect(() => {
    async function acquireDeskToken() {
      if (initialDeskId && initialSessionId) {
        try {
          const res = await getCustomerToken(initialDeskId, initialSessionId);
          setDeskToken(res.access_token);
        } catch (err) {
          console.error('Failed to authenticate desk token:', err);
        }
      }
    }
    acquireDeskToken();
  }, [initialDeskId, initialSessionId]);

  // Desk WebSocket channel
  useCafeWebSocket({
    channel: initialDeskId ? `customer:${initialDeskId}` : 'admin',
    onEvent: (_event) => {
      queryClient.invalidateQueries({ queryKey: ['desk-session'] });
    },
  });

  // Fetch Desk Session Data
  const { data: deskSession, isLoading: isSessionLoading } = useQuery<CustomerDeskSession>({
    queryKey: ['desk-session', deskToken],
    queryFn: () => fetchDeskSession(deskToken!),
    enabled: !!deskToken,
    refetchInterval: 6000,
  });

  // Fetch Menu Items
  const { data: menuItems = [] } = useQuery<MenuItem[]>({
    queryKey: ['customer-menu'],
    queryFn: fetchMenuItems,
  });

  // Order Placement Mutation
  const orderMutation = useMutation({
    mutationFn: (items: { menu_item_id: string; quantity: number }[]) =>
      placeCustomerOrder(deskToken!, items),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['desk-session'] });
      setCart({});
      setIsMenuDrawerOpen(false);
      setOrderSuccessMessage('Order sent to the kitchen! Track progress below.');
      setTimeout(() => setOrderSuccessMessage(null), 5000);
    },
  });

  const handleAddToCart = (itemId: string) => {
    setCart((prev) => ({
      ...prev,
      [itemId]: (prev[itemId] || 0) + 1,
    }));
  };

  const handleRemoveFromCart = (itemId: string) => {
    setCart((prev) => {
      const current = prev[itemId] || 0;
      if (current <= 1) {
        const copy = { ...prev };
        delete copy[itemId];
        return copy;
      }
      return { ...prev, [itemId]: current - 1 };
    });
  };

  const cartItemsList = Object.entries(cart).map(([itemId, qty]) => {
    const item = menuItems.find((m) => m.id === itemId);
    const unitPrice = item ? Number(item.price) : 0;
    return {
      itemId,
      name: item?.name || 'Item',
      quantity: qty,
      unitPrice,
      subtotal: unitPrice * qty,
    };
  });

  const cartSubtotal = cartItemsList.reduce((acc, it) => acc + it.subtotal, 0);

  // SVG Radial Ring Calculation
  const radius = 80;
  const circumference = 2 * Math.PI * radius;
  const totalMins = deskSession?.allocated_minutes || 60;
  const remainingMins = deskSession?.remaining_minutes ?? 60;
  const progressRatio = Math.max(0, Math.min(1, remainingMins / totalMins));
  const strokeDashoffset = circumference - progressRatio * circumference;

  const ringColor =
    remainingMins <= 0
      ? 'stroke-rose-500'
      : remainingMins <= 10
      ? 'stroke-amber-400'
      : 'stroke-emerald-400';

  if (!deskToken || isSessionLoading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 glass-panel rounded-2xl text-center border border-slate-800">
        <div className="w-12 h-12 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin mb-4"></div>
        <h3 className="text-lg font-bold text-white font-display">Initializing Desk HUD...</h3>
        <p className="text-xs text-slate-400 font-mono-code mt-1">
          Zero-trust JWT verification & ephemeral session handshake
        </p>
      </div>
    );
  }

  return (
    <div className="relative space-y-6">
      {/* Top Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 glass-panel p-4 rounded-xl border border-slate-800">
        <div>
          <div className="flex items-center space-x-2">
            <span className="text-[10px] font-mono-code uppercase px-2 py-0.5 rounded bg-purple-950/60 text-purple-300 border border-purple-800/60">
              {deskSession?.tier} TIER
            </span>
            <h2 className="text-xl font-bold tracking-wide font-display text-white">
              {deskSession?.station_name}
            </h2>
          </div>
          <p className="text-xs text-slate-400 font-mono-code mt-0.5">
            Active Session ID: {deskSession?.session_id.slice(0, 12)}...
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsMenuDrawerOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs uppercase tracking-wider rounded-xl transition-all shadow-lg hover:shadow-emerald-500/25"
          >
            <Utensils className="w-4 h-4" />
            <span>Order Food & Drinks</span>
            {cartItemsList.length > 0 && (
              <span className="bg-black text-emerald-400 px-2 py-0.5 rounded-full text-[10px] font-mono-code">
                {cartItemsList.length}
              </span>
            )}
          </button>

          {onBackToMatrix && (
            <button
              onClick={onBackToMatrix}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition-colors"
            >
              Back to Matrix
            </button>
          )}
        </div>
      </div>

      {orderSuccessMessage && (
        <div className="p-4 rounded-xl bg-emerald-950/90 border border-emerald-600/80 text-emerald-200 text-xs flex items-center justify-between shadow-lg">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{orderSuccessMessage}</span>
          </div>
          <button onClick={() => setOrderSuccessMessage(null)} className="text-emerald-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main HUD Dashboard */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Radial Countdown Timer Card */}
        <div className="glass-panel p-6 rounded-2xl border border-slate-800 flex flex-col items-center justify-center text-center relative overflow-hidden">
          <div className="text-xs font-mono-code uppercase text-slate-400 tracking-wider mb-2">
            Remaining Session Time
          </div>

          <div className="relative w-52 h-52 flex items-center justify-center my-2">
            <svg className="w-full h-full transform -rotate-90">
              {/* Background ring */}
              <circle
                cx="104"
                cy="104"
                r={radius}
                className="stroke-slate-800"
                strokeWidth="12"
                fill="transparent"
              />
              {/* Animated Progress Ring */}
              <circle
                cx="104"
                cy="104"
                r={radius}
                className={`${ringColor} transition-all duration-1000 ease-out`}
                strokeWidth="12"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                fill="transparent"
              />
            </svg>

            {/* Inner Content */}
            <div className="absolute flex flex-col items-center justify-center">
              <span className="text-3xl font-bold font-mono-code text-white">
                {remainingMins}m
              </span>
              <span className="text-[11px] font-mono-code text-slate-400">
                of {totalMins}m
              </span>
            </div>
          </div>

          {remainingMins <= 10 && remainingMins > 0 && (
            <div className="flex items-center gap-1.5 text-amber-400 text-xs font-semibold mt-2">
              <AlertTriangle className="w-4 h-4" />
              <span>Session expiring soon! Notify staff to extend.</span>
            </div>
          )}

          {remainingMins <= 0 && (
            <div className="flex items-center gap-1.5 text-rose-400 text-xs font-semibold mt-2">
              <AlertTriangle className="w-4 h-4 animate-bounce" />
              <span>Session in Overtime! Station checkout required.</span>
            </div>
          )}
        </div>

        {/* Live Running Bill Breakdown */}
        <div className="glass-panel p-6 rounded-2xl border border-slate-800 flex flex-col justify-between">
          <div>
            <h3 className="text-base font-bold text-white font-display mb-4 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              Live Running Tab Breakdown
            </h3>

            <div className="space-y-3 text-xs">
              <div className="flex justify-between items-center text-slate-400">
                <span>Station Rate ({deskSession?.tier})</span>
                <span className="font-mono-code text-slate-200">
                  ₹{Number(deskSession?.hourly_rate).toFixed(2)}/hr
                </span>
              </div>
              <div className="flex justify-between items-center text-slate-400">
                <span>Elapsed Playtime</span>
                <span className="font-mono-code text-slate-200">
                  {deskSession?.elapsed_minutes} mins
                </span>
              </div>
              <div className="flex justify-between items-center text-slate-400">
                <span>Station Time Charge</span>
                <span className="font-mono-code text-slate-200 font-semibold">
                  ₹{Number(deskSession?.time_charge).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between items-center text-slate-400">
                <span>Kitchen Food & Beverages Tab</span>
                <span className="font-mono-code text-slate-200 font-semibold">
                  ₹{Number(deskSession?.orders_charge).toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800 mt-6">
            <div className="flex justify-between items-center">
              <span className="text-xs uppercase font-mono-code text-slate-400 font-bold">
                Total Current Balance
              </span>
              <span className="text-xl font-bold font-mono-code text-emerald-400">
                ₹{Number(deskSession?.running_total).toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        {/* Active Kitchen Pipeline Tracker */}
        <div className="glass-panel p-6 rounded-2xl border border-slate-800 flex flex-col justify-between">
          <div>
            <h3 className="text-base font-bold text-white font-display mb-3 flex items-center gap-2">
              <Utensils className="w-4 h-4 text-cyan-400" />
              Kitchen Order Pipeline Tracker
            </h3>

            {deskSession?.active_orders && deskSession.active_orders.length > 0 ? (
              <div className="space-y-3 max-h-56 overflow-y-auto pr-1">
                {deskSession.active_orders.map((ord) => {
                  const isQueued = ord.status === 'QUEUED';
                  const isPreparing = ord.status === 'PREPARING';
                  const isServed = ord.status === 'SERVED';

                  return (
                    <div key={ord.id} className="bg-slate-900/80 p-3 rounded-xl border border-slate-800 space-y-2">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-semibold text-white">
                          Order #{ord.id.slice(0, 6)}
                        </span>
                        <span className="text-emerald-400 font-mono-code font-bold">
                          ₹{Number(ord.total_amount).toFixed(2)}
                        </span>
                      </div>

                      {/* Stepper Pipeline */}
                      <div className="flex items-center justify-between text-[10px] font-mono-code pt-1">
                        <span className={`flex items-center gap-1 ${isQueued || isPreparing || isServed ? 'text-cyan-400' : 'text-slate-600'}`}>
                          <span className="w-2 h-2 rounded-full bg-cyan-400"></span> Queued
                        </span>
                        <ChevronRight className="w-3 h-3 text-slate-600" />
                        <span className={`flex items-center gap-1 ${isPreparing || isServed ? 'text-amber-400 font-bold' : 'text-slate-600'}`}>
                          <span className={`w-2 h-2 rounded-full ${isPreparing ? 'bg-amber-400 animate-pulse' : isServed ? 'bg-amber-400' : 'bg-slate-700'}`}></span> Cooking
                        </span>
                        <ChevronRight className="w-3 h-3 text-slate-600" />
                        <span className={`flex items-center gap-1 ${isServed ? 'text-emerald-400 font-bold' : 'text-slate-600'}`}>
                          <span className={`w-2 h-2 rounded-full ${isServed ? 'bg-emerald-400' : 'bg-slate-700'}`}></span> Served
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="h-40 flex flex-col items-center justify-center text-slate-500 text-xs border border-dashed border-slate-800 rounded-xl">
                <Utensils className="w-6 h-6 mb-2 opacity-40" />
                <span>No active food orders placed yet</span>
              </div>
            )}
          </div>

          <button
            onClick={() => setIsMenuDrawerOpen(true)}
            className="w-full mt-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition-colors"
          >
            Browse Menu & Add Items →
          </button>
        </div>
      </div>

      {/* SLIDE-OUT MENU DRAWER */}
      {isMenuDrawerOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex justify-end">
          <div className="w-full max-w-md bg-[#0f172a] h-full flex flex-col border-l border-slate-800 shadow-2xl p-6 animate-in slide-in-from-right duration-300">
            {/* Drawer Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <Utensils className="w-5 h-5 text-emerald-400" />
                <h3 className="text-lg font-bold text-white font-display">Cyber Cafe Menu</h3>
              </div>
              <button
                onClick={() => setIsMenuDrawerOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Menu Items List */}
            <div className="flex-1 overflow-y-auto py-4 space-y-3 pr-1">
              {menuItems.map((item) => {
                const qtyInCart = cart[item.id] || 0;
                return (
                  <div
                    key={item.id}
                    className="bg-slate-900/80 p-3 rounded-xl border border-slate-800 flex items-center justify-between"
                  >
                    <div>
                      <div className="text-sm font-semibold text-white">{item.name}</div>
                      <span className="text-[11px] font-mono-code text-slate-400">{item.category}</span>
                      <div className="font-mono-code text-emerald-400 font-bold text-xs mt-0.5">
                        ₹{Number(item.price).toFixed(2)}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {qtyInCart > 0 && (
                        <>
                          <button
                            onClick={() => handleRemoveFromCart(item.id)}
                            className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <span className="font-mono-code text-xs font-bold text-white w-4 text-center">
                            {qtyInCart}
                          </span>
                        </>
                      )}
                      <button
                        onClick={() => handleAddToCart(item.id)}
                        className="p-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-black font-bold transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Cart & Checkout Footer */}
            <div className="pt-4 border-t border-slate-800 space-y-3">
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">Order Subtotal:</span>
                <span className="font-mono-code text-emerald-400 font-bold text-base">
                  ₹{cartSubtotal.toFixed(2)}
                </span>
              </div>

              <button
                disabled={cartItemsList.length === 0 || orderMutation.isPending}
                onClick={() =>
                  orderMutation.mutate(
                    cartItemsList.map((c) => ({
                      menu_item_id: c.itemId,
                      quantity: c.quantity,
                    }))
                  )
                }
                className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-40 shadow-lg hover:shadow-emerald-500/30"
              >
                {orderMutation.isPending ? 'Placing Order...' : `Place Order (₹${cartSubtotal.toFixed(2)})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
