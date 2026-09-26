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
      queryClient.invalidateQueries({ queryKey: ['kitchen-orders'] });
    },
    onError: (err: any) => {
      addNotification('FOOD_ORDER', '⚠️ Stock Adjustment Failed', err.message || 'Could not adjust inventory stock.');
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-[#E2E8F0]">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-xl sm:text-2xl font-bold font-display text-[#172554] tracking-wide">
              Inventory Management
            </h2>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-[#DCFCE7] text-[#15803D] font-mono-code font-bold border border-[#BBF7D0]">
              {menuItems.length} Products
            </span>
          </div>
          <p className="text-xs text-[#64748B] mt-1 font-sans">
            Real-time stock monitoring, critical restock reviews, pricing, and cafe inventory control.
          </p>
        </div>

        {/* Sub-Tabs: Inventory | Revenue Analytics */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 bg-[#FFFFFF] p-1.5 rounded-2xl border border-[#E2E8F0] shadow-xs no-scrollbar">
          <button
            onClick={() => setActiveTab('INVENTORY')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
              activeTab === 'INVENTORY'
                ? 'bg-[#172554] text-white font-bold shadow-xs'
                : 'text-[#64748B] hover:text-[#0F172A]'
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            <span>Inventory</span>
          </button>

          <button
            onClick={() => setActiveTab('REVENUE')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
              activeTab === 'REVENUE'
                ? 'bg-[#172554] text-white font-bold shadow-xs'
                : 'text-[#64748B] hover:text-[#0F172A]'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Revenue Analytics</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* INVENTORY TABLE */}
      {/* ========================================================================= */}
      {activeTab === 'INVENTORY' && (
        <div className="space-y-4">
          {/* Top Bar: Search / Filters on left, + Add Item on RIGHT SIDE */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              {/* Search input */}
              <div className="relative">
                <Search className="w-4 h-4 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search items..."
                  className="pl-9 pr-3 py-2 bg-[#FFFFFF] border border-[#E2E8F0] rounded-xl text-xs text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:border-[#EA580C] w-44 sm:w-60 font-mono-code transition-colors shadow-xs"
                />
              </div>

              {/* Status Review Filter Buttons */}
              <div className="flex items-center gap-1 bg-[#FFFFFF] p-1 rounded-xl border border-[#E2E8F0] text-xs shadow-xs">
                {(['ALL', 'CRITICAL', 'MODERATE', 'ENOUGH'] as const).map((filter) => {
                  const count = filter === 'ALL'
                    ? menuItems.length
                    : menuItems.filter((i) => evaluateStockStatus(i.stock ?? 0).status === filter).length;

                  return (
                    <button
                      key={filter}
                      onClick={() => setStatusFilter(filter)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                        statusFilter === filter
                          ? 'bg-[#172554] text-white shadow-xs'
                          : 'text-[#64748B] hover:text-[#0F172A]'
                      }`}
                    >
                      <span>{filter === 'ALL' ? 'All' : filter.charAt(0) + filter.slice(1).toLowerCase()}</span>
                      <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono-code ${
                        filter === 'CRITICAL' ? 'bg-[#FEE2E2] text-[#B91C1C]' :
                        filter === 'MODERATE' ? 'bg-[#FEF3C7] text-[#B45309]' :
                        filter === 'ENOUGH' ? 'bg-[#DCFCE7] text-[#15803D]' :
                        'bg-[#F1F5F9] text-[#64748B]'
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
              className="px-4 py-2.5 bg-[#EA580C] hover:bg-[#C2410C] text-white font-bold rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-sm shrink-0 active:scale-95 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>ADD ITEM</span>
            </button>
          </div>

          {/* Table displaying items in rows with the 4 columns requested */}
          <div className="bg-[#FFFFFF] rounded-2xl sm:rounded-3xl border border-[#E2E8F0] overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-[#FFF7ED] text-[#64748B] font-mono-code border-b border-[#E2E8F0] uppercase tracking-wider text-[11px] font-bold">
                  <tr>
                    <th className="p-4 sm:px-6">Item Name</th>
                    <th className="p-4 sm:px-6">In Stock</th>
                    <th className="p-4 sm:px-6">Status Review</th>
                    <th className="p-4 sm:px-6 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0]">
                  {filteredItems.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="p-10 text-center text-[#64748B] text-xs">
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
                          className="hover:bg-[#FFF7ED]/40 transition-colors group"
                        >
                          {/* Column 1: Item Name */}
                          <td className="p-4 sm:px-6">
                            <div className="flex flex-col space-y-1">
                              <span className="font-bold text-[#0F172A] text-sm tracking-wide">
                                {item.name}
                              </span>
                              <div className="flex items-center gap-2 text-[11px]">
                                <span className="px-2 py-0.5 rounded-md bg-[#FFF7ED] text-[#EA580C] font-mono-code border border-[#FED7AA] text-[10px] font-bold">
                                  {item.category.toLowerCase().includes('food') ? 'Food' : 'Drinks'}
                                </span>
                                <span className="font-mono-code font-bold text-[#172554]">
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
                                  className="w-6 h-6 rounded-lg bg-[#F8FAFC] hover:bg-[#F1F5F9] disabled:opacity-30 disabled:cursor-not-allowed active:bg-[#E2E8F0] text-[#0F172A] flex items-center justify-center border border-[#E2E8F0] transition-colors shadow-xs cursor-pointer"
                                  title="Decrease stock (-1)"
                                >
                                  <Minus className="w-3.5 h-3.5" />
                                </button>
                                <div className="flex items-baseline gap-1.5 min-w-[56px] justify-center">
                                  <span className="font-mono-code font-black text-base text-[#0F172A]">
                                    {st}
                                  </span>
                                  <span className="text-xs text-[#64748B] font-mono-code">units</span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => restockMutation.mutate({ id: item.id, amount: 1 })}
                                  className="w-6 h-6 rounded-lg bg-[#F8FAFC] hover:bg-[#F1F5F9] active:bg-[#E2E8F0] text-[#0F172A] flex items-center justify-center border border-[#E2E8F0] transition-colors shadow-xs cursor-pointer"
                                  title="Increase stock (+1)"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          </td>

                          {/* Column 3: Status Review */}
                          <td className="p-4 sm:px-6">
                            <span
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold font-mono-code border ${
                                statusInfo.status === 'CRITICAL'
                                  ? 'bg-[#FEE2E2] text-[#B91C1C] border-[#FECACA]'
                                  : statusInfo.status === 'MODERATE'
                                  ? 'bg-[#FEF3C7] text-[#B45309] border-[#FDE68A]'
                                  : 'bg-[#DCFCE7] text-[#15803D] border-[#BBF7D0]'
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                  statusInfo.status === 'CRITICAL'
                                    ? 'bg-[#B91C1C] animate-pulse'
                                    : statusInfo.status === 'MODERATE'
                                    ? 'bg-[#B45309]'
                                    : 'bg-[#15803D]'
                                }`}
                              />
                              <span>{statusInfo.label}</span>
                            </span>
                          </td>

                          {/* Column 4: Action */}
                          <td className="p-4 sm:px-6 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => openFullEditModal(item)}
                                className="p-1.5 text-[#64748B] hover:text-[#172554] hover:bg-[#F1F5F9] rounded-lg transition-colors cursor-pointer"
                                title="Edit Item Details"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteMutation.mutate(item.id)}
                                className="p-1.5 text-[#B91C1C] hover:text-[#991B1B] hover:bg-[#FEE2E2] rounded-lg transition-colors cursor-pointer"
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
      {/* REVENUE ANALYTICS TAB */}
      {/* ========================================================================= */}
      {activeTab === 'REVENUE' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#FFFFFF] p-4 rounded-2xl border border-[#E2E8F0] shadow-xs">
            <div>
              <h3 className="text-base sm:text-lg font-bold text-[#172554] font-display flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-[#EA580C]" />
                <span>Financial Performance & Revenue Dashboard</span>
              </h3>
              <p className="text-xs text-[#64748B] font-sans mt-0.5">
                Track gaming console income, cafe food revenue, and player transaction history.
              </p>
            </div>

            <div className="inline-flex p-1 bg-[#FFF7ED] rounded-xl border border-[#E2E8F0]">
              <button
                onClick={() => setRevenuePeriod('DAY')}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  revenuePeriod === 'DAY'
                    ? 'bg-[#172554] text-white shadow-xs'
                    : 'text-[#64748B] hover:text-[#0F172A]'
                }`}
              >
                Today (Day)
              </button>
              <button
                onClick={() => setRevenuePeriod('WEEK')}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  revenuePeriod === 'WEEK'
                    ? 'bg-[#172554] text-white shadow-xs'
                    : 'text-[#64748B] hover:text-[#0F172A]'
                }`}
              >
                This Week
              </button>
              <button
                onClick={() => setRevenuePeriod('MONTH')}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  revenuePeriod === 'MONTH'
                    ? 'bg-[#172554] text-white shadow-xs'
                    : 'text-[#64748B] hover:text-[#0F172A]'
                }`}
              >
                This Month
              </button>
            </div>
          </div>

          {/* 4 Financial KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-[#FFFFFF] p-5 rounded-2xl border border-[#E2E8F0] shadow-xs space-y-2">
              <div className="flex items-center justify-between text-[#64748B] text-xs font-semibold">
                <span>Total Gross Revenue</span>
                <span className="p-1.5 rounded-lg bg-[#EFF6FF] text-[#172554] font-bold">₹</span>
              </div>
              <div className="text-2xl sm:text-3xl font-black text-[#172554] font-mono-code">
                ₹{revenueData.totalRevenue.toFixed(2)}
              </div>
              <div className="text-[11px] text-[#15803D] font-semibold flex items-center gap-1">
                <ArrowUpRight className="w-3.5 h-3.5" />
                <span>100% Zero-Drift Financials</span>
              </div>
            </div>

            <div className="bg-[#FFFFFF] p-5 rounded-2xl border border-[#E2E8F0] shadow-xs space-y-2">
              <div className="flex items-center justify-between text-[#64748B] text-xs font-semibold">
                <span>Console Gaming Income</span>
                <Gamepad2 className="w-4 h-4 text-[#15803D]" />
              </div>
              <div className="text-2xl sm:text-3xl font-black text-[#15803D] font-mono-code">
                ₹{revenueData.gamingRevenue.toFixed(2)}
              </div>
              <div className="text-[11px] text-[#64748B] font-mono-code">
                {((revenueData.gamingRevenue / (revenueData.totalRevenue || 1)) * 100).toFixed(0)}% of total revenue
              </div>
            </div>

            <div className="bg-[#FFFFFF] p-5 rounded-2xl border border-[#E2E8F0] shadow-xs space-y-2">
              <div className="flex items-center justify-between text-[#64748B] text-xs font-semibold">
                <span>Cafe & Food Sales</span>
                <ShoppingBag className="w-4 h-4 text-[#EA580C]" />
              </div>
              <div className="text-2xl sm:text-3xl font-black text-[#EA580C] font-mono-code">
                ₹{revenueData.foodRevenue.toFixed(2)}
              </div>
              <div className="text-[11px] text-[#64748B] font-mono-code">
                {((revenueData.foodRevenue / (revenueData.totalRevenue || 1)) * 100).toFixed(0)}% of total revenue
              </div>
            </div>

            <div className="bg-[#FFFFFF] p-5 rounded-2xl border border-[#E2E8F0] shadow-xs space-y-2">
              <div className="flex items-center justify-between text-[#64748B] text-xs font-semibold">
                <span>Completed Sessions</span>
                <Clock className="w-4 h-4 text-[#64748B]" />
              </div>
              <div className="text-2xl sm:text-3xl font-black text-[#172554] font-mono-code">
                {revenueData.sessionsCount}
              </div>
              <div className="text-[11px] text-[#64748B] font-mono-code">
                Avg: ₹{revenueData.averageSessionBill.toFixed(0)} / session
              </div>
            </div>
          </div>

          {/* Visual Daily / Weekly Comparison Chart Bars */}
          <div className="bg-[#FFFFFF] p-5 rounded-2xl border border-[#E2E8F0] shadow-xs space-y-4">
            <h4 className="text-sm font-bold text-[#172554] flex items-center justify-between">
              <span>Revenue Distribution ({revenuePeriod === 'DAY' ? 'Today' : revenuePeriod === 'WEEK' ? 'Last 7 Days' : 'Last 14 Days'})</span>
              <div className="flex items-center gap-3 text-xs font-mono-code font-normal">
                <span className="flex items-center gap-1 text-[#15803D]">
                  <span className="w-2.5 h-2.5 rounded bg-[#15803D]"></span> Gaming Console
                </span>
                <span className="flex items-center gap-1 text-[#EA580C]">
                  <span className="w-2.5 h-2.5 rounded bg-[#EA580C]"></span> Cafe & Food
                </span>
              </div>
            </h4>

            <div className="space-y-3 pt-2">
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
                        <span className="text-[#0F172A] font-semibold">{d?.label || 'Period'}</span>
                        <span className="text-[#172554] font-bold">₹{safeTotal.toFixed(2)}</span>
                      </div>
                      <div className="w-full bg-[#F1F5F9] rounded-full h-3 flex overflow-hidden">
                        <div
                          className="bg-[#15803D] h-full transition-all duration-500"
                          style={{ width: `${safeTotal > 0 ? (safeGaming / safeTotal) * pct : 0}%` }}
                          title={`Gaming: ₹${safeGaming}`}
                        />
                        <div
                          className="bg-[#EA580C] h-full transition-all duration-500"
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

      {/* ========================================================================= */}
      {/* ADD ITEM MODAL */}
      {/* ========================================================================= */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#FFFFFF] max-w-md w-full rounded-2xl p-5 sm:p-6 border border-[#E2E8F0] shadow-2xl relative space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-2 border-b border-[#E2E8F0]">
              <h3 className="text-base font-bold text-[#172554] font-display flex items-center gap-2">
                <Package className="w-4 h-4 text-[#EA580C]" />
                <span>Add New Inventory Item</span>
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-[#64748B] hover:text-[#0F172A] cursor-pointer"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateMenuItem} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                  Item Name
                </label>
                <input
                  type="text"
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  placeholder="e.g. Mountain Dew Game Fuel"
                  className="w-full px-3.5 py-2.5 bg-[#FFF7ED] border border-[#E2E8F0] rounded-xl text-xs text-[#0F172A] placeholder-[#94A3B8] focus:outline-none focus:border-[#EA580C]"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Category
                  </label>
                  <select
                    value={newItemCategory}
                    onChange={(e) => setNewItemCategory(e.target.value as 'Food' | 'Drinks')}
                    className="w-full px-3.5 py-2.5 bg-[#FFF7ED] border border-[#E2E8F0] rounded-xl text-xs text-[#0F172A] focus:outline-none focus:border-[#EA580C]"
                  >
                    <option value="Food">Food</option>
                    <option value="Drinks">Drinks</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Price in ₹ (INR)
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={newItemPrice}
                    onChange={(e) => setNewItemPrice(e.target.value)}
                    placeholder="e.g. 150"
                    className="w-full px-3.5 py-2.5 bg-[#FFF7ED] border border-[#E2E8F0] rounded-xl text-xs text-[#0F172A] font-mono-code focus:outline-none focus:border-[#EA580C]"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                  Initial Stock Count
                </label>
                <input
                  type="number"
                  value={newItemStock}
                  onChange={(e) => setNewItemStock(e.target.value)}
                  placeholder="e.g. 20"
                  min="0"
                  className="w-full px-3.5 py-2.5 bg-[#FFF7ED] border border-[#E2E8F0] rounded-xl text-xs text-[#0F172A] font-mono-code focus:outline-none focus:border-[#EA580C]"
                  required
                />
              </div>

              <div className="pt-2 flex gap-2 border-t border-[#E2E8F0]">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 py-2.5 rounded-xl bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#64748B] text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-[#EA580C] hover:bg-[#C2410C] text-white text-xs font-bold uppercase tracking-wider shadow-sm cursor-pointer"
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
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#FFFFFF] max-w-md w-full rounded-2xl p-5 sm:p-6 border border-[#E2E8F0] shadow-2xl relative space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-2 border-b border-[#E2E8F0]">
              <h3 className="text-base font-bold text-[#172554] font-display flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-[#172554]" />
                <span>Edit Item: {editModalItem.name}</span>
              </h3>
              <button
                onClick={() => setEditModalItem(null)}
                className="text-[#64748B] hover:text-[#0F172A] cursor-pointer"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveFullEdit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                  Item Name
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 bg-[#FFF7ED] border border-[#E2E8F0] rounded-xl text-xs text-[#0F172A] focus:outline-none focus:border-[#EA580C]"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Category
                  </label>
                  <select
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value as 'Food' | 'Drinks')}
                    className="w-full px-3 py-2 bg-[#FFF7ED] border border-[#E2E8F0] rounded-xl text-xs text-[#0F172A] focus:outline-none focus:border-[#EA580C]"
                  >
                    <option value="Food">Food</option>
                    <option value="Drinks">Drinks</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Price in ₹
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={editPrice}
                    onChange={(e) => setEditPrice(e.target.value)}
                    className="w-full px-3 py-2 bg-[#FFF7ED] border border-[#E2E8F0] rounded-xl text-xs text-[#0F172A] font-mono-code focus:outline-none focus:border-[#EA580C]"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                  Current Inventory Stock (Units)
                </label>
                <input
                  type="number"
                  value={editStock}
                  onChange={(e) => setEditStock(e.target.value)}
                  className="w-full px-3 py-2 bg-[#FFF7ED] border border-[#E2E8F0] rounded-xl text-xs text-[#0F172A] font-mono-code focus:outline-none focus:border-[#EA580C]"
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
                  className="rounded border-[#E2E8F0] bg-[#FFF7ED] text-[#15803D]"
                />
                <label htmlFor="editStockCheckbox" className="text-xs text-[#0F172A] font-semibold cursor-pointer">
                  Item is In Stock &amp; Available for Orders
                </label>
              </div>

              <div className="pt-2 flex gap-2 border-t border-[#E2E8F0]">
                <button
                  type="button"
                  onClick={() => setEditModalItem(null)}
                  className="flex-1 py-2.5 rounded-xl bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#64748B] text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-[#EA580C] hover:bg-[#C2410C] text-white text-xs font-bold uppercase tracking-wider shadow-sm cursor-pointer"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
