import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChefHat,
  Clock,
  CheckCircle,
  Flame,
  Utensils,
  Bell,
  ArrowRight,
  Layers,
} from 'lucide-react';
import { Order, OrderStatus } from '../types';
import { fetchKitchenOrders, updateKitchenOrderStatus } from '../api';
import { useCafeWebSocket } from '../hooks/useCafeWebSocket';
import { play880HzChime } from '../utils/audioNotifier';

export const KitchenKanban: React.FC = () => {
  const queryClient = useQueryClient();
  const [mobileLaneFilter, setMobileLaneFilter] = useState<'ALL' | OrderStatus>('ALL');

  // Listen to WebSocket on channel "admin"
  useCafeWebSocket({
    channel: 'admin',
    onEvent: (event) => {
      if (event.event_type === 'ORDER_CREATED') {
        play880HzChime();
      }
    },
  });

  // Fetch kitchen orders
  const { data: orders = [] } = useQuery<Order[]>({
    queryKey: ['kitchen-orders'],
    queryFn: fetchKitchenOrders,
    refetchInterval: 8000,
  });

  // Optimistic status progression mutation
  const progressMutation = useMutation({
    mutationFn: ({ orderId, nextStatus }: { orderId: string; nextStatus: OrderStatus }) =>
      updateKitchenOrderStatus(orderId, nextStatus),
    onMutate: async ({ orderId, nextStatus }) => {
      await queryClient.cancelQueries({ queryKey: ['kitchen-orders'] });
      const previousOrders = queryClient.getQueryData<Order[]>(['kitchen-orders']);

      queryClient.setQueryData<Order[]>(['kitchen-orders'], (old) => {
        if (!old) return [];
        return old.map((order) =>
          order.id === orderId ? { ...order, status: nextStatus } : order
        );
      });

      return { previousOrders };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousOrders) {
        queryClient.setQueryData(['kitchen-orders'], context.previousOrders);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['kitchen-orders'] });
      queryClient.invalidateQueries({ queryKey: ['stations-live'] });
    },
  });

  const handleProgress = (order: Order) => {
    let nextStatus: OrderStatus | null = null;
    if (order.status === 'QUEUED') nextStatus = 'PREPARING';
    else if (order.status === 'PREPARING') nextStatus = 'SERVED';

    if (nextStatus) {
      progressMutation.mutate({ orderId: order.id, nextStatus });
    }
  };

  const getElapsedTime = (isoString: string) => {
    const diff = Math.max(0, Math.floor((Date.now() - new Date(isoString).getTime()) / 60000));
    return `${diff}m ago`;
  };

  const queuedOrders = orders.filter((o) => o.status === 'QUEUED');
  const preparingOrders = orders.filter((o) => o.status === 'PREPARING');
  const servedOrders = orders.filter((o) => o.status === 'SERVED');

  const swimlanes = [
    {
      status: 'QUEUED' as OrderStatus,
      title: 'Incoming / Queued',
      items: queuedOrders,
      badge: 'bg-rose-950/80 text-rose-300 border-rose-800/80',
      border: 'border-rose-500/30',
      icon: Bell,
    },
    {
      status: 'PREPARING' as OrderStatus,
      title: 'In Preparation',
      items: preparingOrders,
      badge: 'bg-amber-950/80 text-amber-300 border-amber-800/80',
      border: 'border-amber-500/30',
      icon: Flame,
    },
    {
      status: 'SERVED' as OrderStatus,
      title: 'Ready / Served',
      items: servedOrders,
      badge: 'bg-emerald-950/80 text-emerald-300 border-emerald-800/80',
      border: 'border-emerald-500/30',
      icon: CheckCircle,
    },
  ];

  const visibleLanes =
    mobileLaneFilter === 'ALL'
      ? swimlanes
      : swimlanes.filter((lane) => lane.status === mobileLaneFilter);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4 glass-panel p-3.5 sm:p-4 rounded-xl border border-slate-800">
        <div className="flex items-center space-x-3">
          <div className="p-2 sm:p-2.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/30 shrink-0">
            <ChefHat className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div>
            <h2 className="text-lg sm:text-xl font-bold tracking-wide font-display text-white">
              KITCHEN DISPLAY SYSTEM
            </h2>
            <p className="text-[11px] sm:text-xs text-slate-400 font-mono-code">
              Real-time Swimlanes • 880Hz Audio Chimes • Instant Dispatch
            </p>
          </div>
        </div>

        <button
          onClick={play880HzChime}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono-code border border-slate-700 transition-colors"
          title="Test 880Hz Alert Tone"
        >
          <Bell className="w-3.5 h-3.5 text-amber-400" />
          <span className="hidden sm:inline">Test 880Hz Chime</span>
          <span className="sm:hidden">Test Chime</span>
        </button>
      </div>

      {/* Mobile Swimlane Filter Tabs (Visible on screens < md) */}
      <div className="md:hidden flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs font-mono-code">
        <button
          onClick={() => setMobileLaneFilter('ALL')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-bold transition-all shrink-0 ${
            mobileLaneFilter === 'ALL'
              ? 'bg-slate-200 text-slate-950 shadow-md'
              : 'bg-slate-900/80 text-slate-400 border border-slate-800'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>All ({orders.length})</span>
        </button>

        <button
          onClick={() => setMobileLaneFilter('QUEUED')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-bold transition-all shrink-0 ${
            mobileLaneFilter === 'QUEUED'
              ? 'bg-rose-500 text-black shadow-md'
              : 'bg-rose-950/40 text-rose-300 border border-rose-800/40'
          }`}
        >
          <Bell className="w-3.5 h-3.5" />
          <span>Queued ({queuedOrders.length})</span>
        </button>

        <button
          onClick={() => setMobileLaneFilter('PREPARING')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-bold transition-all shrink-0 ${
            mobileLaneFilter === 'PREPARING'
              ? 'bg-amber-500 text-black shadow-md'
              : 'bg-amber-950/40 text-amber-300 border border-amber-800/40'
          }`}
        >
          <Flame className="w-3.5 h-3.5" />
          <span>Cooking ({preparingOrders.length})</span>
        </button>

        <button
          onClick={() => setMobileLaneFilter('SERVED')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-bold transition-all shrink-0 ${
            mobileLaneFilter === 'SERVED'
              ? 'bg-emerald-500 text-black shadow-md'
              : 'bg-emerald-950/40 text-emerald-300 border border-emerald-800/40'
          }`}
        >
          <CheckCircle className="w-3.5 h-3.5" />
          <span>Served ({servedOrders.length})</span>
        </button>
      </div>

      {/* Kanban Board Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
        {visibleLanes.map((lane) => {
          const Icon = lane.icon;
          return (
            <div
              key={lane.status}
              className={`rounded-2xl glass-panel p-3.5 sm:p-4 border ${lane.border} flex flex-col h-[560px] sm:h-[650px] md:h-[700px]`}
            >
              {/* Lane Header */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-800/80 mb-3 sm:mb-4">
                <div className="flex items-center space-x-2">
                  <Icon className="w-4 h-4 text-slate-300" />
                  <h3 className="font-bold text-white text-sm font-display">{lane.title}</h3>
                </div>
                <span className={`text-xs px-2.5 py-0.5 rounded-full border font-mono-code font-bold ${lane.badge}`}>
                  {lane.items.length}
                </span>
              </div>

              {/* Lane Cards Container */}
              <div className="flex-1 overflow-y-auto space-y-3 sm:space-y-3.5 pr-1">
                {lane.items.length === 0 ? (
                  <div className="h-40 flex flex-col items-center justify-center text-slate-500 text-xs border border-dashed border-slate-800 rounded-xl">
                    <Utensils className="w-6 h-6 mb-2 opacity-40" />
                    <span>No tickets in {lane.title.toLowerCase()}</span>
                  </div>
                ) : (
                  lane.items.map((order) => (
                    <div
                      key={order.id}
                      className="bg-slate-900/90 hover:bg-slate-900 rounded-xl p-3 sm:p-4 border border-slate-800 transition-all shadow-md space-y-3"
                    >
                      {/* Ticket Header */}
                      <div className="flex items-start justify-between">
                        <div>
                          <span className="text-[10px] font-mono-code text-slate-400 uppercase">
                            Desk Station
                          </span>
                          <div className="text-sm font-bold text-white font-display">
                            {order.station_name || 'Desk Session'}
                          </div>
                        </div>

                        <span className="flex items-center gap-1 text-[11px] font-mono-code text-slate-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                          <Clock className="w-3 h-3 text-cyan-400" />
                          {getElapsedTime(order.created_at)}
                        </span>
                      </div>

                      {/* Items List */}
                      <div className="bg-slate-950/70 rounded-lg p-2.5 border border-slate-800/60 space-y-1.5 text-xs">
                        {order.items.map((item) => (
                          <div key={item.id} className="flex justify-between items-center text-slate-200">
                            <span className="font-medium">
                              <span className="text-emerald-400 font-mono-code font-bold mr-1.5">
                                {item.quantity}x
                              </span>
                              {item.menu_item_name}
                            </span>
                            <span className="font-mono-code text-slate-400 text-[11px]">
                              ₹{Number(item.subtotal).toFixed(2)}
                            </span>
                          </div>
                        ))}
                      </div>

                      {/* Total and Progression Button */}
                      <div className="flex items-center justify-between pt-1">
                        <div className="text-xs font-mono-code text-slate-300">
                          Total: <span className="text-emerald-400 font-bold">₹{Number(order.total_amount).toFixed(2)}</span>
                        </div>

                        {order.status === 'QUEUED' && (
                          <button
                            onClick={() => handleProgress(order)}
                            className="flex items-center gap-1.5 px-3.5 py-2 min-h-[38px] bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-lg text-xs transition-all shadow-sm active:scale-95"
                          >
                            <span>Start Cook</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {order.status === 'PREPARING' && (
                          <button
                            onClick={() => handleProgress(order)}
                            className="flex items-center gap-1.5 px-3.5 py-2 min-h-[38px] bg-emerald-500 hover:bg-emerald-400 text-black font-bold rounded-lg text-xs transition-all shadow-sm active:scale-95"
                          >
                            <span>Serve Order</span>
                            <CheckCircle className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {order.status === 'SERVED' && (
                          <span className="text-[11px] font-mono-code text-emerald-400 flex items-center gap-1">
                            <CheckCircle className="w-3.5 h-3.5" />
                            Fulfilled
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
