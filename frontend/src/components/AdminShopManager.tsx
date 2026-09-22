import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ShoppingBag,
  Plus,
  Minus,
  Gamepad2,
  Trash2,
  Edit2,
  XCircle,
  TrendingUp,
  Package,
  ArrowUpRight,
  Clock,
  Search,
} from 'lucide-react';
import {
  fetchAdminMenuItems,
  createMenuItemApi,
  updateMenuItemApi,
  deleteMenuItemApi,
  restockMenuItemApi,
  fetchRevenueAnalyticsApi,
} from '../api';
import { MenuItem, RevenueAnalyticsSummary } from '../types';
import { POLL_INTERVALS, evaluateStockStatus, StockStatusType } from '../constants';
import { useNotificationStore } from '../store/notificationStore';

const defaultRevenueSummary: RevenueAnalyticsSummary = {
  totalRevenue: 0,
  gamingRevenue: 0,
  foodRevenue: 0,
  sessionsCount: 0,
  averageSessionBill: 0,
  topSellingItem: 'None',
  chartData: [],
};

export const AdminShopManager: React.FC = () => {
  const queryClient = useQueryClient();
  const { addNotification } = useNotificationStore();

  const { data: menuItems = [] } = useQuery<MenuItem[]>({
    queryKey: ['admin-menu'],
    queryFn: fetchAdminMenuItems,
    refetchInterval: POLL_INTERVALS.MENU,
  });

  const createMutation = useMutation({
    mutationFn: createMenuItemApi,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-menu'] });
      setNewItemName('');
      setNewItemPrice('');
      setNewItemStock('20');
      setShowAddModal(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => updateMenuItemApi(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-menu'] });
      setEditModalItem(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteMenuItemApi,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-menu'] });
      queryClient.invalidateQueries({ queryKey: ['kitchen-orders'] });
      addNotification('FOOD_ORDER', '🗑️ Item Deleted', 'Inventory item removed successfully.');
    },
    onError: (err: any) => {
      addNotification('FOOD_ORDER', '⚠️ Delete Failed', err.message || 'Failed to delete item.');
    },
  });

  const restockMutation = useMutation({
    mutationFn: ({ id, amount }: { id: string; amount: number }) => restockMenuItemApi(id, amount),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-menu'] });
    },
  });

  const [activeTab, setActiveTab] = useState<'INVENTORY' | 'REVENUE'>('INVENTORY');
  const [revenuePeriod, setRevenuePeriod] = useState<'DAY' | 'WEEK' | 'MONTH'>('DAY');

  // Search & Status Filters for Remade Inventory Table
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | StockStatusType>('ALL');

  // Form State for Adding Inventory Item Modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemCategory, setNewItemCategory] = useState<'Food' | 'Drinks'>('Food');
  const [newItemPrice, setNewItemPrice] = useState('');
  const [newItemStock, setNewItemStock] = useState('20');

  // Full Edit Modal State
  const [editModalItem, setEditModalItem] = useState<MenuItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState<'Food' | 'Drinks'>('Food');
  const [editPrice, setEditPrice] = useState('');
  const [editStock, setEditStock] = useState('20');
  const [editAvailable, setEditAvailable] = useState(true);

  const safeMenuItems = Array.isArray(menuItems) ? menuItems : [];

  const filteredItems = safeMenuItems.filter((item) => {
    const st = item?.stock ?? 0;
    const status = evaluateStockStatus(st).status;
    if (statusFilter !== 'ALL' && status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const name = (item?.name || '').toLowerCase();
      const cat = (item?.category || '').toLowerCase();
      return name.includes(q) || cat.includes(q);
    }
    return true;
  });

  const handleCreateMenuItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim() || !newItemPrice) return;

    const p = parseFloat(newItemPrice) || 50;
    const st = parseInt(newItemStock) || 20;

    createMutation.mutate({
      name: newItemName.trim(),
      category: newItemCategory,
      price: p,
      is_available: true,
      stock: st,
    });
  };

  const openFullEditModal = (item: MenuItem) => {
    setEditModalItem(item);
    setEditName(item.name);
    setEditCategory((item.category.toLowerCase().includes('drink') || item.category.toLowerCase().includes('beverage')) ? 'Drinks' : 'Food');
    setEditPrice(String(item.price));
    setEditStock(String(item.stock ?? 20));
    setEditAvailable(item.is_available);
  };

  const handleSaveFullEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editModalItem) return;

    const p = parseFloat(editPrice) || Number(editModalItem.price);
    const st = parseInt(editStock) || Number(editModalItem.stock ?? 20);

    updateMutation.mutate({
      id: editModalItem.id,
      data: {
        name: editName.trim(),
        category: editCategory,
        price: p,
        stock: st,
        is_available: editAvailable && st > 0,
      },
    });
  };

  // Real-time Revenue metrics directly aggregated from SQLite DB
  const { data: revenueData = defaultRevenueSummary } = useQuery<RevenueAnalyticsSummary>({
    queryKey: ['admin-revenue-analytics', revenuePeriod],
    queryFn: () => fetchRevenueAnalyticsApi(revenuePeriod),
    refetchInterval: 8000,
  });

  return (
    <div className="space-y-6 relative z-10">
      {/* Top Header & Sub-Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-800/80">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-xl sm:text-2xl font-bold font-display text-white tracking-wide">
              Inventory Management
            </h2>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-950/80 text-emerald-400 font-mono-code font-bold border border-emerald-800/60">
              {menuItems.length} Products
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Real-time stock monitoring, critical restock reviews, pricing, and cafe inventory control.
          </p>
        </div>

        {/* Sub-Tabs: Inventory | Revenue Analytics | Games | Bookings */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 bg-slate-950/90 p-1.5 rounded-2xl border border-slate-800 shadow-inner no-scrollbar">
          <button
            onClick={() => setActiveTab('INVENTORY')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
              activeTab === 'INVENTORY'
                ? 'bg-emerald-500 text-slate-950 font-bold shadow-[0_0_12px_rgba(16,185,129,0.3)]'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            <span>Inventory</span>
          </button>

          <button
            onClick={() => setActiveTab('REVENUE')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
              activeTab === 'REVENUE'
                ? 'bg-cyan-500 text-slate-950 font-bold shadow-[0_0_12px_rgba(6,182,212,0.3)]'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Revenue Analytics</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* INVENTORY TABLE: REMADE ACCORDING TO REQUIREMENTS */}
      {/* ========================================================================= */}
      {activeTab === 'INVENTORY' && (
        <div className="space-y-4">
          {/* Top Bar: Search / Filters on left, + Add Item on RIGHT SIDE */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              {/* Search input */}
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search items..."
                  className="pl-9 pr-3 py-2 bg-slate-950/90 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 w-44 sm:w-60 font-mono-code"
                />
              </div>

              {/* Status Review Filter Buttons */}
              <div className="flex items-center gap-1 bg-slate-950/90 p-1 rounded-xl border border-slate-800 text-xs">
                {(['ALL', 'CRITICAL', 'MODERATE', 'ENOUGH'] as const).map((filter) => {
                  const count = filter === 'ALL'
                    ? menuItems.length
                    : menuItems.filter((i) => evaluateStockStatus(i.stock ?? 0).status === filter).length;

                  return (
                    <button
                      key={filter}
                      onClick={() => setStatusFilter(filter)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all flex items-center gap-1.5 ${
                        statusFilter === filter
                          ? 'bg-slate-800 text-white shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <span>{filter === 'ALL' ? 'All' : filter.charAt(0) + filter.slice(1).toLowerCase()}</span>
                      <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono-code ${
                        filter === 'CRITICAL' ? 'bg-rose-950/80 text-rose-300' :
                        filter === 'MODERATE' ? 'bg-amber-950/80 text-amber-300' :
                        filter === 'ENOUGH' ? 'bg-emerald-950/80 text-emerald-300' :
                        'bg-slate-900 text-slate-400'
                      }`}>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Option for Add Item on Right Side */}
            <button
              id="inventory-add-item-btn"
              onClick={() => setShowAddModal(true)}
              className="px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-bold rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/35 shrink-0 active:scale-95"
            >
              <Plus className="w-4 h-4" />
              <span>ADD ITEM</span>
            </button>
          </div>

          {/* Table displaying items in rows with the 4 columns requested */}
          <div className="glass-panel rounded-2xl border border-slate-800/90 overflow-hidden shadow-2xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-950/95 text-slate-400 font-mono-code border-b border-slate-800 uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="p-4 sm:px-6">Item Name</th>
                    <th className="p-4 sm:px-6">In Stock</th>
                    <th className="p-4 sm:px-6">Status Review</th>
                    <th className="p-4 sm:px-6 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredItems.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="p-10 text-center text-slate-500 text-xs">
                        No inventory items found matching your filters.
                      </td>
                    </tr>
                  ) : (
                    filteredItems.map((item) => {
                      const st = item.stock ?? 0;
                      const statusInfo = evaluateStockStatus(st);

                      return (
                        <tr
                          key={item.id}
                          className="hover:bg-slate-900/50 transition-colors group"
                        >
                          {/* Column 1: Item Name */}
                          <td className="p-4 sm:px-6">
                            <div className="flex flex-col space-y-1">
                              <span className="font-bold text-white text-sm tracking-wide">
                                {item.name}
                              </span>
                              <div className="flex items-center gap-2 text-[11px]">
                                <span className="px-2 py-0.5 rounded-md bg-slate-900 text-slate-400 font-mono-code border border-slate-800 text-[10px]">
                                  {item.category.toLowerCase().includes('food') ? 'Food' : 'Drinks'}
                                </span>
                                <span className="font-mono-code font-bold text-emerald-400">
                                  ₹{Number(item.price).toFixed(2)}
                                </span>
                              </div>
                            </div>
                          </td>

                          {/* Column 2: In Stock */}
                          <td className="p-4 sm:px-6">
                            <div className="flex flex-col space-y-1.5">
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => restockMutation.mutate({ id: item.id, amount: -1 })}
                                  disabled={st <= 0}
                                  className="w-6 h-6 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed active:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center border border-slate-800 hover:border-slate-700 transition-colors shadow-sm"
                                  title="Decrease stock (-1)"
                                >
                                  <Minus className="w-3.5 h-3.5" />
                                </button>
                                <div className="flex items-baseline gap-1.5 min-w-[56px] justify-center">
                                  <span className="font-mono-code font-black text-base text-white">
                                    {st}
                                  </span>
                                  <span className="text-xs text-slate-400 font-mono-code">units</span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => restockMutation.mutate({ id: item.id, amount: 1 })}
                                  className="w-6 h-6 rounded-lg bg-slate-900 hover:bg-emerald-950/80 active:bg-emerald-900 text-emerald-400 hover:text-emerald-300 flex items-center justify-center border border-slate-800 hover:border-emerald-500/40 transition-colors shadow-sm"
                                  title="Increase stock (+1)"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                </button>
                              </div>
                              {/* Stock Level Bar */}
                              <div className="w-28 sm:w-36 bg-slate-900 rounded-full h-1.5 overflow-hidden border border-slate-800/80">
                                <div
                                  className={`h-full rounded-full transition-all duration-300 ${
                                    st <= 5
                                      ? 'bg-rose-500'
                                      : st <= 15
                                      ? 'bg-amber-400'
                                      : 'bg-emerald-400'
                                  }`}
                                  style={{ width: `${Math.min(100, Math.max(8, (st / 40) * 100))}%` }}
                                />
                              </div>
                            </div>
                          </td>

                          {/* Column 3: Status Review (Critical, Moderate, Enough) */}
                          <td className="p-4 sm:px-6">
                            <span
                              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${statusInfo.color}`}
                            >
                              <span className={`w-2 h-2 rounded-full ${statusInfo.dot}`}></span>
                              <span>{statusInfo.label}</span>
                            </span>
                          </td>

                          {/* Column 4: Action Column */}
                          <td className="p-4 sm:px-6 text-right">
                            <div className="inline-flex items-center gap-2">
                              {/* Edit Details */}
                              <button
                                onClick={() => openFullEditModal(item)}
                                className="p-1.5 text-slate-400 hover:text-cyan-300 hover:bg-slate-900 rounded-lg transition-colors border border-transparent hover:border-slate-800"
                                title="Edit Item Details & Stock"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>

                              {/* Delete Item */}
                              <button
                                onClick={() => {
                                  deleteMutation.mutate(item.id);
                                }}
                                className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-slate-900 rounded-lg transition-colors border border-transparent hover:border-slate-800"
                                title="Delete Item"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
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
      {/* ADD ITEM MODAL */}
      {/* ========================================================================= */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel max-w-md w-full rounded-2xl p-5 sm:p-6 border border-emerald-500/40 shadow-2xl relative space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h3 className="text-base font-bold text-white font-display flex items-center gap-2">
                <Package className="w-4 h-4 text-emerald-400" />
                <span>Add New Inventory Item</span>
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateMenuItem} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Item Name
                </label>
                <input
                  type="text"
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  placeholder="e.g. Mountain Dew Game Fuel"
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Category
                  </label>
                  <select
                    value={newItemCategory}
                    onChange={(e) => setNewItemCategory(e.target.value as 'Food' | 'Drinks')}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                  >
                    <option value="Food">Food</option>
                    <option value="Drinks">Drinks</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Price in ₹ (INR)
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={newItemPrice}
                    onChange={(e) => setNewItemPrice(e.target.value)}
                    placeholder="e.g. 150"
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white font-mono-code focus:outline-none focus:border-emerald-500"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Initial Stock Count
                </label>
                <input
                  type="number"
                  value={newItemStock}
                  onChange={(e) => setNewItemStock(e.target.value)}
                  placeholder="e.g. 20"
                  min="0"
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white font-mono-code focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 text-xs font-bold uppercase tracking-wider shadow-lg shadow-emerald-500/20"
                >
                  Save Item
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* FULL EDIT ITEM MODAL */}
      {/* ========================================================================= */}
      {editModalItem && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel max-w-md w-full rounded-2xl p-5 sm:p-6 border border-cyan-500/40 shadow-2xl relative space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h3 className="text-base font-bold text-white font-display flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-cyan-400" />
                <span>Edit Item: {editModalItem.name}</span>
              </h3>
              <button
                onClick={() => setEditModalItem(null)}
                className="text-slate-400 hover:text-white"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveFullEdit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Item Name
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-cyan-500"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Category
                  </label>
                  <select
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value as 'Food' | 'Drinks')}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-cyan-500"
                  >
                    <option value="Food">Food</option>
                    <option value="Drinks">Drinks</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Price in ₹
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={editPrice}
                    onChange={(e) => setEditPrice(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white font-mono-code focus:outline-none focus:border-cyan-500"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Current Inventory Stock (Units)
                </label>
                <input
                  type="number"
                  value={editStock}
                  onChange={(e) => setEditStock(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white font-mono-code focus:outline-none focus:border-cyan-500"
                  min="0"
                  required
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="editStockCheckbox"
                  checked={editAvailable}
                  onChange={(e) => setEditAvailable(e.target.checked)}
                  className="rounded border-slate-800 bg-slate-950 text-emerald-500"
                />
                <label htmlFor="editStockCheckbox" className="text-xs text-slate-300 font-semibold cursor-pointer">
                  Item is In Stock & Available for Orders
                </label>
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditModalItem(null)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold uppercase tracking-wider"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: REVENUE & FINANCIAL DASHBOARD (DAY, WEEK, MONTH) */}
      {/* ========================================================================= */}
      {activeTab === 'REVENUE' && (
        <div className="space-y-5">
          {/* Period Selector: Day, Week, Month */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1 border-b border-slate-800/80">
            <div>
              <h3 className="text-base font-bold text-white font-display flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-cyan-400" />
                <span>Financial Performance & Revenue Dashboard</span>
              </h3>
              <p className="text-xs text-slate-400">
                Track gaming console income, cafe food revenue, and player transaction history.
              </p>
            </div>

            <div className="inline-flex p-1 bg-slate-950 rounded-xl border border-slate-800">
              <button
                onClick={() => setRevenuePeriod('DAY')}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  revenuePeriod === 'DAY'
                    ? 'bg-cyan-500 text-slate-950 shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Today (Day)
              </button>
              <button
                onClick={() => setRevenuePeriod('WEEK')}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  revenuePeriod === 'WEEK'
                    ? 'bg-cyan-500 text-slate-950 shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                This Week
              </button>
              <button
                onClick={() => setRevenuePeriod('MONTH')}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  revenuePeriod === 'MONTH'
                    ? 'bg-cyan-500 text-slate-950 shadow-md'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                This Month
              </button>
            </div>
          </div>

          {/* 4 Financial KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="glass-panel p-5 rounded-2xl border border-cyan-500/30 shadow-[0_8px_30px_rgba(6,182,212,0.12)] space-y-2">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span>Total Gross Revenue</span>
                <span className="p-1.5 rounded-lg bg-cyan-500/20 text-cyan-400">₹</span>
              </div>
              <div className="text-2xl sm:text-3xl font-black text-white font-mono-code">
                ₹{revenueData.totalRevenue.toFixed(2)}
              </div>
              <div className="text-[11px] text-emerald-400 font-semibold flex items-center gap-1">
                <ArrowUpRight className="w-3.5 h-3.5" />
                <span>100% Zero-Drift Financials</span>
              </div>
            </div>

            <div className="glass-panel p-5 rounded-2xl border border-emerald-500/30 shadow-[0_8px_30px_rgba(16,185,129,0.12)] space-y-2">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span>Console Gaming Income</span>
                <Gamepad2 className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-2xl sm:text-3xl font-black text-emerald-400 font-mono-code">
                ₹{revenueData.gamingRevenue.toFixed(2)}
              </div>
              <div className="text-[11px] text-slate-400 font-mono-code">
                {((revenueData.gamingRevenue / (revenueData.totalRevenue || 1)) * 100).toFixed(0)}% of total revenue
              </div>
            </div>

            <div className="glass-panel p-5 rounded-2xl border border-amber-500/30 shadow-[0_8px_30px_rgba(245,158,11,0.12)] space-y-2">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span>Cafe & Food Sales</span>
                <ShoppingBag className="w-4 h-4 text-amber-400" />
              </div>
              <div className="text-2xl sm:text-3xl font-black text-amber-400 font-mono-code">
                ₹{revenueData.foodRevenue.toFixed(2)}
              </div>
              <div className="text-[11px] text-slate-400 font-mono-code">
                {((revenueData.foodRevenue / (revenueData.totalRevenue || 1)) * 100).toFixed(0)}% of total revenue
              </div>
            </div>

            <div className="glass-panel p-5 rounded-2xl border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span>Completed Sessions</span>
                <Clock className="w-4 h-4 text-slate-400" />
              </div>
              <div className="text-2xl sm:text-3xl font-black text-white font-mono-code">
                {revenueData.sessionsCount}
              </div>
              <div className="text-[11px] text-slate-400 font-mono-code">
                Avg: ₹{revenueData.averageSessionBill.toFixed(0)} / session
              </div>
            </div>
          </div>

          {/* Visual Daily / Weekly Comparison Chart Bars */}
          <div className="glass-panel p-5 rounded-2xl border border-slate-800 space-y-4">
            <h4 className="text-sm font-bold text-white flex items-center justify-between">
              <span>Revenue Distribution ({revenuePeriod === 'DAY' ? 'Today' : revenuePeriod === 'WEEK' ? 'Last 7 Days' : 'Last 14 Days'})</span>
              <div className="flex items-center gap-3 text-xs font-mono-code font-normal">
                <span className="flex items-center gap-1 text-emerald-400">
                  <span className="w-2.5 h-2.5 rounded bg-emerald-500"></span> Gaming Console
                </span>
                <span className="flex items-center gap-1 text-amber-400">
                  <span className="w-2.5 h-2.5 rounded bg-amber-500"></span> Cafe & Food
                </span>
              </div>
            </h4>

            <div className="space-y-2.5 pt-2">
              {(() => {
                const chartData = Array.isArray(revenueData?.chartData) ? revenueData.chartData : [];
                const totals = chartData.map((c) => Number(c?.total || 0));
                const maxVal = totals.length > 0 ? Math.max(...totals, 1000) : 1000;

                return chartData.map((d) => {
                  const safeTotal = Number(d?.total || 0);
                  const safeGaming = Number(d?.gaming || 0);
                  const safeFood = Number(d?.food || 0);
                  const pct = Math.min(100, Math.max(8, (safeTotal / maxVal) * 100));

                  return (
                    <div key={d?.label || Math.random()} className="space-y-1">
                      <div className="flex justify-between text-xs font-mono-code">
                        <span className="text-slate-300 font-semibold">{d?.label || 'Period'}</span>
                        <span className="text-white font-bold">₹{safeTotal.toFixed(2)}</span>
                      </div>
                      <div className="w-full bg-slate-900 rounded-full h-3 flex overflow-hidden">
                        <div
                          className="bg-emerald-500 h-full transition-all duration-500"
                          style={{ width: `${safeTotal > 0 ? (safeGaming / safeTotal) * pct : 0}%` }}
                          title={`Gaming: ₹${safeGaming}`}
                        />
                        <div
                          className="bg-amber-500 h-full transition-all duration-500"
                          style={{ width: `${safeTotal > 0 ? (safeFood / safeTotal) * pct : 0}%` }}
                          title={`Food: ₹${safeFood}`}
                        />
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
