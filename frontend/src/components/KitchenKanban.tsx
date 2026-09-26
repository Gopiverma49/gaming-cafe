import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChefHat,
  Plus,
  Edit2,
  Trash2,
  X,
  Search,
  Eye,
  UtensilsCrossed,
  Clock,
  Flame,
  Bell,
  ArrowRight,
  CheckCircle2,
} from 'lucide-react';
import { MenuItem, Order, OrderStatus } from '../types';
import {
  fetchKitchenOrders,
  updateKitchenOrderStatus,
  fetchAdminMenuItems,
  createMenuItemApi,
  updateMenuItemApi,
  deleteMenuItemApi,
} from '../api';
import { useCafeWebSocket } from '../hooks/useCafeWebSocket';
import { useNotificationStore } from '../store/notificationStore';
import { useLoungeStore } from '../store/loungeStore';

export const KitchenKanban: React.FC = () => {
  const queryClient = useQueryClient();
  const { addNotification } = useNotificationStore();

  const { data: kitchenMenuItems = [] } = useQuery<MenuItem[]>({
    queryKey: ['admin-menu'],
    queryFn: fetchAdminMenuItems,
    refetchInterval: 8000,
  });

  const createItemMutation = useMutation({
    mutationFn: createMenuItemApi,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-menu'] });
      setNewItemName('');
      setNewItemPrice('');
      setShowAddModal(false);
    },
  });

  const updateItemMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => updateMenuItemApi(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-menu'] });
      setEditModalItem(null);
    },
  });

  const deleteItemMutation = useMutation({
    mutationFn: deleteMenuItemApi,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-menu'] });
      queryClient.invalidateQueries({ queryKey: ['kitchen-orders'] });
      addNotification('FOOD_ORDER', '🗑️ Item Removed', 'Menu item removed successfully.');
    },
    onError: (err: any) => {
      addNotification('FOOD_ORDER', '⚠️ Delete Failed', err.message || 'Could not delete item.');
    },
  });

  // Primary view: MENU (Menu management)
  const [activeSubView] = useState<'MENU' | 'LIVE_ORDERS'>('MENU');

  // Menu Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');

  // Add Item Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemCategory, setNewItemCategory] = useState<'Food' | 'Drinks'>('Food');
  const [newItemPrice, setNewItemPrice] = useState('');

  // Edit Item Modal
  const [editModalItem, setEditModalItem] = useState<MenuItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState<string>('Food');
  const [editPrice, setEditPrice] = useState('');

  // Customer Menu Live Preview Modal
  const [showCustomerPreview, setShowCustomerPreview] = useState(false);
  const [previewCategory, setPreviewCategory] = useState<'ALL' | 'Food' | 'Beverages'>('ALL');

  // Mobile lane filter for Live Orders view
  const [mobileLaneFilter, setMobileLaneFilter] = useState<'ALL' | OrderStatus>('ALL');

  // Listen to WebSocket on channel "admin"
  useCafeWebSocket({
    channel: 'admin',
    onEvent: (event) => {
      if (event.event_type === 'ORDER_CREATED') {
        addNotification(
          'FOOD_ORDER',
          '🍳 New Food Order Received',
          'A customer placed an order from their gaming desk.'
        );
      }
    },
  });

  // Fetch kitchen orders
  const { data: orders = [] } = useQuery<Order[]>({
    queryKey: ['kitchen-orders'],
    queryFn: fetchKitchenOrders,
    refetchInterval: 8000,
  });

  // Status progression mutation for KDS live orders
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
    onSettled: (_data, _error, variables) => {
      if (variables) {
        const lounge = useLoungeStore.getState();
        if (variables.nextStatus === 'CANCELLED') {
          lounge.removeInSeatOrder(variables.orderId);
        } else {
          lounge.updateInSeatOrderStatus(variables.orderId, variables.nextStatus);
        }
      }
      queryClient.invalidateQueries({ queryKey: ['kitchen-orders'] });
      queryClient.invalidateQueries({ queryKey: ['station-matrix'] });
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

  // Filtered Menu Items for Admin
  const filteredMenuItems = useMemo(() => {
    return kitchenMenuItems.filter((item) => {
      const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCat =
        selectedCategory === 'ALL' ||
        item.category.toLowerCase() === selectedCategory.toLowerCase();

      return matchesSearch && matchesCat;
    });
  }, [kitchenMenuItems, searchQuery, selectedCategory]);

  const safeMenuItems = Array.isArray(kitchenMenuItems) ? kitchenMenuItems : [];
  const safeOrders = Array.isArray(orders) ? orders : [];

  // Summary Metrics
  const totalItems = safeMenuItems.length;
  const foodCount = safeMenuItems.filter((i) => (i?.category || '').toLowerCase().includes('food') || (i?.category || '').toLowerCase().includes('snack')).length;
  const drinksCount = safeMenuItems.filter((i) => (i?.category || '').toLowerCase().includes('drink') || (i?.category || '').toLowerCase().includes('beverage')).length;
  const pendingOrdersCount = safeOrders.filter((o) => o?.status !== 'SERVED').length;

  // Add Item Handler
  const handleAddNewItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim() || !newItemPrice) return;

    const p = parseFloat(newItemPrice);
    if (isNaN(p) || p <= 0) return;

    createItemMutation.mutate({
      name: newItemName.trim(),
      category: newItemCategory,
      price: p,
      is_available: true,
      stock: 30,
    });
  };

  // Open Full Edit Modal
  const openEditModal = (item: MenuItem) => {
    setEditModalItem(item);
    setEditName(item.name);
    setEditCategory(item.category);
    setEditPrice(String(item.price));
  };

  // Save Full Edit Modal
  const handleSaveFullEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editModalItem || !editName.trim() || !editPrice) return;

    const p = parseFloat(editPrice);
    if (isNaN(p) || p <= 0) return;

    updateItemMutation.mutate({
      id: editModalItem.id,
      data: {
        name: editName.trim(),
        category: editCategory,
        price: p,
        is_available: true,
      },
    });
  };

  // Delete Item
  const handleDeleteItem = (item: MenuItem) => {
    deleteItemMutation.mutate(item.id);
  };

  const queuedOrders = safeOrders.filter((o) => o?.status === 'QUEUED');
  const preparingOrders = safeOrders.filter((o) => o?.status === 'PREPARING');
  const servedOrders = safeOrders.filter((o) => o?.status === 'SERVED');

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
      title: 'Completed / Served',
      items: servedOrders,
      badge: 'bg-emerald-950/80 text-emerald-300 border-emerald-800/80',
      border: 'border-emerald-500/30',
      icon: CheckCircle2,
    },
  ];

  return (
    <div className="space-y-6 relative z-10">
      {/* ========================================================================= */}
      {/* SECTION HEADER */}
      {/* ========================================================================= */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-800/80">
        <div>
          <div className="flex items-center gap-2.5">
            <ChefHat className="w-6 h-6 text-amber-400" />
            <h2 className="text-xl sm:text-2xl font-black font-display text-white tracking-wide">
              Kitchen Menu
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Manage food & beverage catalog, pricing, and live customer offerings
          </p>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* QUICK SUMMARY METRICS */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="glass-panel p-3.5 rounded-xl border border-slate-800/80 flex flex-col justify-between">
          <span className="text-[11px] font-mono-code uppercase text-slate-400">Total Items</span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-xl font-black font-display text-white">{totalItems}</span>
            <span className="text-[10px] text-emerald-400 font-mono-code">items</span>
          </div>
        </div>

        <div className="glass-panel p-3.5 rounded-xl border border-slate-800/80 flex flex-col justify-between">
          <span className="text-[11px] font-mono-code uppercase text-slate-400">Food</span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-xl font-black font-display text-amber-400">{foodCount}</span>
            <span className="text-[10px] text-slate-500 font-mono-code">items</span>
          </div>
        </div>

        <div className="glass-panel p-3.5 rounded-xl border border-slate-800/80 flex flex-col justify-between">
          <span className="text-[11px] font-mono-code uppercase text-slate-400">Drinks</span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-xl font-black font-display text-cyan-400">{drinksCount}</span>
            <span className="text-[10px] text-slate-500 font-mono-code">items</span>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: MENU CATALOG MANAGEMENT (THE REMADE VIEW) */}
      {/* ========================================================================= */}
      {activeSubView === 'MENU' && (
        <div className="space-y-4">
          {/* Controls Bar: Search & Category Filter Pills */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-950/60 p-2.5 rounded-2xl border border-slate-800">
            <div className="flex flex-wrap items-center gap-2.5">
              {/* Search input */}
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search item name..."
                  className="pl-9 pr-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-500 w-48 sm:w-64 font-mono-code"
                />
              </div>

              {/* Category Pills */}
              <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs">
                {(['ALL', 'Food', 'Drinks'] as const).map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-3 py-1 rounded-lg text-[11px] font-bold transition-all ${
                      selectedCategory === cat
                        ? 'bg-slate-800 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {cat === 'ALL' ? 'All' : cat}
                  </button>
                ))}
              </div>
            </div>

            {/* ADD ITEM Button at top of table */}
            <button
              id="kitchen-add-item-btn"
              onClick={() => setShowAddModal(true)}
              className="px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-bold rounded-xl text-xs uppercase tracking-wider flex items-center gap-1.5 transition-all shadow-lg shadow-amber-500/20 active:scale-95 shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>ADD ITEM</span>
            </button>
          </div>

          {/* Row-wise Table for Kitchen Menu Items */}
          <div className="glass-panel rounded-2xl border border-slate-800/90 overflow-hidden shadow-2xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-950/95 text-slate-400 font-mono-code border-b border-slate-800 uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="p-4 sm:px-6">Item Name</th>
                    <th className="p-4 sm:px-6">Category</th>
                    <th className="p-4 sm:px-6 text-right">Price</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredMenuItems.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="p-12 text-center text-slate-500">
                        No menu items found.
                      </td>
                    </tr>
                  ) : (
                    filteredMenuItems.map((item) => {
                      const isFood =
                        item.category.toLowerCase().includes('food') ||
                        item.category.toLowerCase().includes('snack');

                      return (
                        <tr
                          key={item.id}
                          className="hover:bg-slate-900/50 transition-colors group"
                        >
                          {/* Column 1: Item Name */}
                          <td className="p-4 sm:px-6">
                            <span className="font-bold text-white text-sm sm:text-base group-hover:text-amber-300 transition-colors">
                              {item.name}
                            </span>
                          </td>

                          {/* Column 2: Category */}
                          <td className="p-4 sm:px-6">
                            <span
                              className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-mono-code font-semibold border ${
                                isFood
                                  ? 'bg-amber-950/70 text-amber-300 border-amber-800/70'
                                  : 'bg-cyan-950/70 text-cyan-300 border-cyan-800/70'
                              }`}
                            >
                              {isFood ? 'Food' : 'Drinks'}
                            </span>
                          </td>

                          {/* Column 3: Price & Actions */}
                          <td className="p-4 sm:px-6 text-right">
                            <div className="inline-flex items-center gap-4 justify-end">
                              <span className="font-mono-code font-black text-base sm:text-lg text-emerald-400">
                                ₹{Number(item.price).toFixed(2)}
                              </span>

                              {/* Edit Modal & Delete Actions */}
                              <div className="flex items-center gap-1 border-l border-slate-800 pl-3">
                                <button
                                  onClick={() => openEditModal(item)}
                                  className="p-1.5 text-slate-400 hover:text-amber-300 hover:bg-slate-900 rounded-lg transition-colors"
                                  title="Edit Item Details"
                                >
                                  <Edit2 className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleDeleteItem(item)}
                                  className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-slate-900 rounded-lg transition-colors"
                                  title="Delete Item"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: LIVE KITCHEN ORDERS (KDS LANES PRESERVED FOR CHEFS) */}
      {/* ========================================================================= */}
      {activeSubView === 'LIVE_ORDERS' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between bg-slate-950/70 p-3 rounded-xl border border-slate-800 text-xs">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
              <span className="font-bold text-white font-mono-code uppercase tracking-wider">
                Kitchen Display System (KDS) Active
              </span>
              <span className="text-slate-400 font-mono-code hidden sm:inline">
                • Orders placed by customers from their desks appear here in real-time
              </span>
            </div>
            <div className="text-amber-400 font-mono-code font-bold">
              {pendingOrdersCount} Active Tickets
            </div>
          </div>

          {/* Mobile Lane Selector */}
          <div className="flex sm:hidden gap-1 p-1 bg-slate-950 rounded-xl border border-slate-800 text-xs font-mono-code">
            {(['ALL', 'QUEUED', 'PREPARING', 'SERVED'] as const).map((lane) => (
              <button
                key={lane}
                onClick={() => setMobileLaneFilter(lane)}
                className={`flex-1 py-1.5 rounded-lg text-center font-bold transition-all ${
                  mobileLaneFilter === lane
                    ? 'bg-amber-500 text-black shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {lane === 'ALL' ? 'All' : lane.charAt(0) + lane.slice(1).toLowerCase()}
              </button>
            ))}
          </div>

          {/* Swimlanes Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {swimlanes.map((lane) => {
              if (mobileLaneFilter !== 'ALL' && mobileLaneFilter !== lane.status) return null;
              const Icon = lane.icon;

              return (
                <div
                  key={lane.status}
                  className={`glass-panel rounded-2xl border ${lane.border} flex flex-col h-[600px] overflow-hidden shadow-xl`}
                >
                  {/* Lane Header */}
                  <div className="p-3.5 border-b border-slate-800 bg-slate-950/70 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon className="w-4 h-4 text-slate-300" />
                      <h3 className="font-bold text-sm text-white font-display uppercase tracking-wider">
                        {lane.title}
                      </h3>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-mono-code font-bold border ${lane.badge}`}>
                      {lane.items.length}
                    </span>
                  </div>

                  {/* Lane Ticket List */}
                  <div className="flex-1 overflow-y-auto p-3 space-y-3">
                    {lane.items.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-600 font-mono-code text-xs">
                        <UtensilsCrossed className="w-8 h-8 mb-2 opacity-30" />
                        No orders in this lane
                      </div>
                    ) : (
                      lane.items.map((order) => (
                        <div
                          key={order.id}
                          className="bg-slate-900/90 rounded-xl p-3.5 border border-slate-800 shadow-md space-y-3 hover:border-slate-700 transition-colors"
                        >
                          <div className="flex items-center justify-between text-xs font-mono-code">
                            <span className="font-bold text-cyan-400">
                              Desk / Ticket #{(order?.id || 'ORD').substring(0, 6)}
                            </span>
                            <div className="flex items-center gap-1 text-slate-400 text-[11px]">
                              <Clock className="w-3 h-3" />
                              <span>{getElapsedTime(order?.created_at || new Date().toISOString())}</span>
                            </div>
                          </div>

                          {/* Items Breakdown */}
                          <div className="space-y-1.5 border-y border-slate-800/80 py-2">
                            {(Array.isArray(order?.items) ? order.items : []).map((it) => (
                              <div
                                key={it.id}
                                className="flex items-center justify-between text-xs text-slate-200"
                              >
                                <div className="flex items-center gap-2">
                                  <span className="w-5 h-5 rounded bg-amber-500/20 text-amber-400 font-bold font-mono-code flex items-center justify-center text-[10px]">
                                    {it.quantity}x
                                  </span>
                                  <span className="font-semibold">{it.menu_item_name}</span>
                                </div>
                                <span className="text-[11px] font-mono-code text-slate-400">
                                  ₹{Number(it.subtotal || 0).toFixed(0)}
                                </span>
                              </div>
                            ))}
                          </div>

                          {/* Status Progression Button */}
                          <div className="flex items-center justify-between pt-1">
                            <div className="text-[11px] font-mono-code text-slate-400">
                              Total: <span className="text-white font-bold">₹{Number(order?.total_amount || 0).toFixed(2)}</span>
                            </div>

                            {lane.status !== 'SERVED' && (
                              <button
                                onClick={() => handleProgress(order)}
                                disabled={progressMutation.isPending}
                                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-amber-500 hover:text-black text-amber-300 text-xs font-bold font-mono-code flex items-center gap-1.5 transition-all shadow-sm active:scale-95"
                              >
                                <span>{lane.status === 'QUEUED' ? 'Start Cooking' : 'Mark Served'}</span>
                                <ArrowRight className="w-3.5 h-3.5" />
                              </button>
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
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: ADD MENU ITEM (REFLECTS LIVE TO CUSTOMERS) */}
      {/* ========================================================================= */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fade-in">
          <div className="glass-panel w-full max-w-md rounded-2xl border border-slate-700/90 shadow-2xl p-6 relative">
            <button
              onClick={() => setShowAddModal(false)}
              className="absolute top-4 right-4 p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
                <ChefHat className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-black font-display text-white">Add Menu Item</h3>
            </div>

            <form onSubmit={handleAddNewItem} className="space-y-4">
              <div>
                <label className="block text-xs font-mono-code text-slate-400 uppercase tracking-wider mb-1.5">
                  Item Name *
                </label>
                <input
                  type="text"
                  required
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  placeholder="Item name"
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-mono-code text-slate-400 uppercase tracking-wider mb-1.5">
                    Category
                  </label>
                  <select
                    value={newItemCategory}
                    onChange={(e) => setNewItemCategory(e.target.value as 'Food' | 'Drinks')}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-amber-500"
                  >
                    <option value="Food">Food</option>
                    <option value="Drinks">Drinks</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-mono-code text-slate-400 uppercase tracking-wider mb-1.5">
                    Price (₹) *
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    required
                    value={newItemPrice}
                    onChange={(e) => setNewItemPrice(e.target.value)}
                    placeholder="150"
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm font-mono-code font-bold text-emerald-400 focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-white hover:bg-slate-900"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black font-bold text-xs uppercase tracking-wider shadow-lg shadow-amber-500/20 active:scale-95"
                >
                  Add Item
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: FULL EDIT MENU ITEM MODAL */}
      {/* ========================================================================= */}
      {editModalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fade-in">
          <div className="glass-panel w-full max-w-md rounded-2xl border border-slate-700/90 shadow-2xl p-6 relative">
            <button
              onClick={() => setEditModalItem(null)}
              className="absolute top-4 right-4 p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
                <Edit2 className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-black font-display text-white">Edit Menu Item</h3>
            </div>

            <form onSubmit={handleSaveFullEdit} className="space-y-4">
              <div>
                <label className="block text-xs font-mono-code text-slate-400 uppercase tracking-wider mb-1.5">
                  Item Name *
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-mono-code text-slate-400 uppercase tracking-wider mb-1.5">
                    Category
                  </label>
                  <select
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-white focus:outline-none focus:border-amber-500"
                  >
                    <option value="Food">Food</option>
                    <option value="Drinks">Drinks</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-mono-code text-slate-400 uppercase tracking-wider mb-1.5">
                    Price (₹) *
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    required
                    value={editPrice}
                    onChange={(e) => setEditPrice(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm font-mono-code font-bold text-emerald-400 focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setEditModalItem(null)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-white hover:bg-slate-900"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs uppercase tracking-wider shadow-lg shadow-amber-500/20 active:scale-95"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: INTERACTIVE CUSTOMER MENU LIVE PREVIEW */}
      {/* ========================================================================= */}
      {showCustomerPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fade-in">
          <div className="glass-panel w-full max-w-lg rounded-2xl border border-cyan-500/30 shadow-2xl p-6 relative">
            <button
              onClick={() => setShowCustomerPreview(false)}
              className="absolute top-4 right-4 p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-9 h-9 rounded-xl bg-cyan-500/20 text-cyan-400 flex items-center justify-center">
                <Eye className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-black font-display text-white">
                Customer Menu Preview
              </h3>
            </div>

            {/* Category Filter Pills inside preview */}
            <div className="flex items-center gap-1.5 py-2.5 border-b border-slate-800 text-xs font-mono-code">
              {(['ALL', 'Food', 'Beverages'] as const).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setPreviewCategory(cat)}
                  className={`px-3 py-1 rounded-lg font-bold transition-all ${
                    previewCategory === cat
                      ? 'bg-cyan-500 text-black shadow-sm'
                      : 'bg-slate-900 text-slate-400 border border-slate-800'
                  }`}
                >
                  {cat === 'ALL' ? 'All' : cat}
                </button>
              ))}
            </div>

            {/* Items List as rendered on customer screens */}
            <div className="max-h-96 overflow-y-auto py-3 space-y-2.5 pr-1">
              {kitchenMenuItems
                .filter((i) => i.is_available !== false)
                .filter((i) =>
                  previewCategory === 'ALL'
                    ? true
                    : i.category.toLowerCase().includes(previewCategory.toLowerCase())
                )
                .map((item) => (
                  <div
                    key={item.id}
                    className="p-3 bg-slate-950/80 rounded-xl border border-slate-800/80 flex items-center justify-between"
                  >
                    <div>
                      <div className="text-xs font-bold text-white">{item.name}</div>
                      <div className="text-[10px] text-slate-400 font-mono-code">{item.category}</div>
                      <div className="text-xs font-mono-code font-bold text-emerald-400 mt-0.5">
                        ₹{Number(item.price).toFixed(2)}
                      </div>
                    </div>
                    <span className="px-3 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-bold font-mono-code">
                      + Add
                    </span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
