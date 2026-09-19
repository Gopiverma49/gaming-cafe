import React, { useState } from 'react';
import {
  ShoppingBag,
  Plus,
  Gamepad2,
  Trash2,
  CheckCircle2,
  CalendarClock,
  Edit2,
  Check,
  X,
  Sparkles,
  SlidersHorizontal,
  XCircle,
  TrendingUp,
  Package,
  ArrowUpRight,
  Clock,
  AlertTriangle,
} from 'lucide-react';
import { useLoungeStore } from '../store/loungeStore';
import { useNotificationStore } from '../store/notificationStore';
import { useQuery } from '@tanstack/react-query';
import { fetchLiveStations } from '../api';
import { StationLive, MenuItem } from '../types';

export const AdminShopManager: React.FC = () => {
  const {
    customMenuItems,
    addMenuItem,
    updateMenuItemPrice,
    updateMenuItem,
    deleteMenuItem,
    restockItem,
    stationGames,
    updateStationGames,
    bookings,
    cancelBooking,
    getRevenueSummary,
  } = useLoungeStore();

  const { addNotification } = useNotificationStore();

  const [activeTab, setActiveTab] = useState<'SHOP' | 'INVENTORY' | 'REVENUE' | 'GAMES' | 'BOOKINGS'>('SHOP');
  const [revenuePeriod, setRevenuePeriod] = useState<'DAY' | 'WEEK' | 'MONTH'>('DAY');

  // Form State for Adding Shop Item
  const [newItemName, setNewItemName] = useState('');
  const [newItemCategory, setNewItemCategory] = useState<'Food' | 'Beverages'>('Food');
  const [newItemPrice, setNewItemPrice] = useState('');
  const [newItemStock, setNewItemStock] = useState('20');
  const [showAddForm, setShowAddForm] = useState(false);

  // Full Edit Modal State
  const [editModalItem, setEditModalItem] = useState<MenuItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState<'Food' | 'Beverages'>('Food');
  const [editPrice, setEditPrice] = useState('');
  const [editStock, setEditStock] = useState('20');
  const [editAvailable, setEditAvailable] = useState(true);

  // Quick inline price editing state
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [tempPrice, setTempPrice] = useState('');

  // Form State for Adding Game to Station
  const [selectedStationForGame, setSelectedStationForGame] = useState('default_ps5');
  const [newGameTitle, setNewGameTitle] = useState('');

  // Stations query
  const { data: stations = [] } = useQuery<StationLive[]>({
    queryKey: ['stations-live'],
    queryFn: fetchLiveStations,
  });

  const handleCreateMenuItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim() || !newItemPrice) return;

    const p = parseFloat(newItemPrice) || 50;
    const st = parseInt(newItemStock) || 20;

    addMenuItem({
      name: newItemName.trim(),
      category: newItemCategory,
      price: p,
      is_available: true,
      stock: st,
    });

    addNotification(
      'MENU_CHANGE',
      '✨ New Item Added to Shop',
      `Added "${newItemName.trim()}" (${newItemCategory}) at ₹${p.toFixed(2)} with ${st} units in stock.`
    );

    setNewItemName('');
    setNewItemPrice('');
    setNewItemStock('20');
    setShowAddForm(false);
  };

  const handleSavePrice = (id: string, itemName: string) => {
    const p = parseFloat(tempPrice);
    if (!isNaN(p) && p > 0) {
      updateMenuItemPrice(id, p);
      addNotification(
        'MENU_CHANGE',
        '💰 Menu Price Altered',
        `Updated price for "${itemName}" to ₹${p.toFixed(2)}.`
      );
    }
    setEditingItemId(null);
  };

  const handleQuickAlterPrice = (item: MenuItem, delta: number) => {
    const newPrice = Math.max(10, Number(item.price) + delta);
    updateMenuItemPrice(item.id, newPrice);
    addNotification(
      'MENU_CHANGE',
      '💰 Quick Price Adjustment',
      `Adjusted "${item.name}" from ₹${item.price} to ₹${newPrice}.`
    );
  };

  const openFullEditModal = (item: MenuItem) => {
    setEditModalItem(item);
    setEditName(item.name);
    setEditCategory(item.category as 'Food' | 'Beverages');
    setEditPrice(String(item.price));
    setEditStock(String(item.stock ?? 20));
    setEditAvailable(item.is_available);
  };

  const handleSaveFullEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editModalItem) return;

    const p = parseFloat(editPrice) || Number(editModalItem.price);
    const st = parseInt(editStock) || Number(editModalItem.stock ?? 20);

    updateMenuItem(editModalItem.id, {
      name: editName.trim(),
      category: editCategory,
      price: p,
      stock: st,
      is_available: editAvailable && st > 0,
    });

    addNotification(
      'MENU_CHANGE',
      '📝 Menu Item & Stock Updated',
      `Successfully updated details for "${editName.trim()}".`
    );

    setEditModalItem(null);
  };

  const handleAddGame = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGameTitle.trim()) return;

    const currentGames = stationGames[selectedStationForGame] || [];
    if (!currentGames.includes(newGameTitle.trim())) {
      updateStationGames(selectedStationForGame, [...currentGames, newGameTitle.trim()]);
      addNotification(
        'MENU_CHANGE',
        '🎮 New Game Added',
        `Added "${newGameTitle.trim()}" to station game offerings.`
      );
    }
    setNewGameTitle('');
  };

  const handleRemoveGame = (stationKey: string, gameName: string) => {
    const currentGames = stationGames[stationKey] || [];
    updateStationGames(
      stationKey,
      currentGames.filter((g) => g !== gameName)
    );
  };

  // Revenue metrics
  const revenueData = getRevenueSummary(revenuePeriod);

  return (
    <div className="space-y-6">
      {/* Top Header & Metrics Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-2 border-b border-slate-800/80">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-xl sm:text-2xl font-bold font-display text-white tracking-wide">
              Shop, Inventory & Financials
            </h2>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-950/80 text-amber-400 font-mono-code font-bold border border-amber-800/60">
              Admin Powers
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Manage inventory stock, alter prices, analyze daily/weekly/monthly revenue, and configure game titles.
          </p>
        </div>

        {/* 5 Admin Management Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 bg-slate-950/90 p-1.5 rounded-2xl border border-slate-800 shadow-inner no-scrollbar">
          <button
            onClick={() => setActiveTab('SHOP')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
              activeTab === 'SHOP'
                ? 'bg-amber-500 text-slate-950 font-bold shadow-[0_0_12px_rgba(245,158,11,0.3)]'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <ShoppingBag className="w-3.5 h-3.5" />
            <span>Shop Menu</span>
          </button>

          <button
            onClick={() => setActiveTab('INVENTORY')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
              activeTab === 'INVENTORY'
                ? 'bg-emerald-500 text-slate-950 font-bold shadow-[0_0_12px_rgba(16,185,129,0.3)]'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Package className="w-3.5 h-3.5" />
            <span>Inventory Stock</span>
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

          <button
            onClick={() => setActiveTab('GAMES')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
              activeTab === 'GAMES'
                ? 'bg-violet-500 text-white font-bold shadow-[0_0_12px_rgba(139,92,246,0.3)]'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Gamepad2 className="w-3.5 h-3.5" />
            <span>Games</span>
          </button>

          <button
            onClick={() => setActiveTab('BOOKINGS')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
              activeTab === 'BOOKINGS'
                ? 'bg-orange-500 text-white font-bold shadow-[0_0_12px_rgba(249,115,22,0.3)]'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <CalendarClock className="w-3.5 h-3.5" />
            <span>Bookings ({bookings.length})</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: ALL ABOUT SHOP (ADD ITEMS, ALTER PRICES, QUICK TWEAKS) */}
      {/* ========================================================================= */}
      {activeTab === 'SHOP' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-xs text-slate-400 font-mono-code">
              Add new snacks, alter prices, and toggle in-stock availability for players in real-time.
            </div>
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition-all shadow-md shadow-emerald-500/20"
            >
              <Plus className="w-4 h-4" />
              <span>{showAddForm ? 'Close Form' : 'Add Item to Shop'}</span>
            </button>
          </div>

          {/* New Item Form */}
          {showAddForm && (
            <form
              onSubmit={handleCreateMenuItem}
              className="glass-panel p-4 sm:p-5 rounded-2xl border border-emerald-500/30 space-y-3 bg-slate-900/90 animate-in fade-in"
            >
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-400" />
                <span>Add Item to Cafe & Shop Inventory</span>
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1 font-semibold">
                    Item Name
                  </label>
                  <input
                    type="text"
                    value={newItemName}
                    onChange={(e) => setNewItemName(e.target.value)}
                    placeholder="e.g. Loaded Nachos & Salsa"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1 font-semibold">
                    Category
                  </label>
                  <select
                    value={newItemCategory}
                    onChange={(e) => setNewItemCategory(e.target.value as 'Food' | 'Beverages')}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                  >
                    <option value="Food">Food / Snacks</option>
                    <option value="Beverages">Beverages / Energy Drinks</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1 font-semibold">
                    Price in ₹ (INR)
                  </label>
                  <input
                    type="number"
                    value={newItemPrice}
                    onChange={(e) => setNewItemPrice(e.target.value)}
                    placeholder="e.g. 180"
                    min="1"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 font-mono-code"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1 font-semibold">
                    Initial Stock Count
                  </label>
                  <input
                    type="number"
                    value={newItemStock}
                    onChange={(e) => setNewItemStock(e.target.value)}
                    placeholder="e.g. 25"
                    min="0"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 font-mono-code"
                    required
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold"
                >
                  Save Item to Catalog
                </button>
              </div>
            </form>
          )}

          {/* Shop Inventory Items Table / Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {customMenuItems.map((item) => (
              <div
                key={item.id}
                className="glass-panel p-4 rounded-2xl border border-slate-800/90 hover:border-slate-700/80 transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-[10px] font-mono-code uppercase px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800">
                      {item.category}
                    </span>

                    {/* Stock status indicator */}
                    <span
                      className={`text-[11px] px-2.5 py-0.5 rounded-full font-semibold border ${
                        (item.stock || 0) <= 0
                          ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                          : (item.stock || 0) <= 5
                          ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                          : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                      }`}
                    >
                      {(item.stock || 0) <= 0
                        ? '✕ Out of Stock'
                        : `${item.stock || 0} in stock`}
                    </span>
                  </div>

                  <h4 className="text-base font-bold text-white mb-2">{item.name}</h4>
                </div>

                {/* Price Alterations & Quick Controls */}
                <div className="space-y-2 pt-3 border-t border-slate-800/80">
                  <div className="flex items-center justify-between">
                    {editingItemId === item.id ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-slate-400">₹</span>
                        <input
                          type="number"
                          value={tempPrice}
                          onChange={(e) => setTempPrice(e.target.value)}
                          className="w-16 px-1.5 py-0.5 bg-slate-950 border border-emerald-500 rounded text-xs text-white font-mono-code"
                          autoFocus
                        />
                        <button
                          onClick={() => handleSavePrice(item.id, item.name)}
                          className="p-1 bg-emerald-500 text-black rounded hover:bg-emerald-400"
                        >
                          <Check className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => setEditingItemId(null)}
                          className="p-1 bg-slate-800 text-slate-300 rounded hover:bg-slate-700"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-black text-emerald-400 font-mono-code">
                          ₹{Number(item.price).toFixed(2)}
                        </span>
                        <button
                          onClick={() => {
                            setEditingItemId(item.id);
                            setTempPrice(String(item.price));
                          }}
                          className="text-slate-500 hover:text-slate-300 p-1"
                          title="Alter Price Numerically"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}

                    {/* Quick Alter Price Buttons: -₹10 and +₹10 */}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleQuickAlterPrice(item, -10)}
                        className="px-2 py-0.5 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white rounded border border-slate-800 text-[11px] font-mono-code"
                        title="Decrease price by ₹10"
                      >
                        -₹10
                      </button>
                      <button
                        onClick={() => handleQuickAlterPrice(item, 10)}
                        className="px-2 py-0.5 bg-slate-900 hover:bg-slate-800 text-emerald-400 hover:text-emerald-300 rounded border border-slate-800 text-[11px] font-mono-code font-bold"
                        title="Increase price by ₹10"
                      >
                        +₹10
                      </button>
                    </div>
                  </div>

                  {/* Actions Row: Full Edit Details & Delete */}
                  <div className="flex items-center justify-between pt-1 border-t border-slate-900 text-xs">
                    <button
                      onClick={() => openFullEditModal(item)}
                      className="text-slate-400 hover:text-cyan-400 flex items-center gap-1 transition-colors text-[11px]"
                    >
                      <SlidersHorizontal className="w-3 h-3" />
                      <span>Edit Item & Stock</span>
                    </button>

                    <button
                      onClick={() => deleteMenuItem(item.id)}
                      className="p-1 text-slate-500 hover:text-rose-400 transition-colors"
                      title="Delete item"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Full Edit Item Modal */}
          {editModalItem && (
            <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="glass-panel max-w-md w-full rounded-2xl p-5 sm:p-6 border border-cyan-500/40 shadow-2xl relative space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <h3 className="text-base font-bold text-white font-display flex items-center gap-2">
                    <Edit2 className="w-4 h-4 text-cyan-400" />
                    <span>Edit Menu Item: {editModalItem.name}</span>
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
                        onChange={(e) => setEditCategory(e.target.value as 'Food' | 'Beverages')}
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-cyan-500"
                      >
                        <option value="Food">Food / Snacks</option>
                        <option value="Beverages">Beverages / Drinks</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">
                        Price in ₹
                      </label>
                      <input
                        type="number"
                        value={editPrice}
                        onChange={(e) => setEditPrice(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white font-mono-code focus:outline-none focus:border-cyan-500"
                        min="1"
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
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: INVENTORY & STOCK MANAGEMENT (RESTOCKING & DEDUCTIONS) */}
      {/* ========================================================================= */}
      {activeTab === 'INVENTORY' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Package className="w-4 h-4 text-emerald-400" />
                <span>Inventory Levels & Restocking</span>
              </h3>
              <p className="text-xs text-slate-400">
                Stock is automatically deducted whenever a player orders food from their desk. Restock items with 1-click.
              </p>
            </div>

            <button
              onClick={() => {
                customMenuItems.forEach((item) => {
                  if ((item.stock || 0) <= 5) {
                    restockItem(item.id, 15);
                  }
                });
                addNotification('SYSTEM', '📦 Bulk Restock Completed', 'Restocked all low-stock items with +15 units.');
              }}
              className="px-3.5 py-1.5 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30 text-xs font-bold flex items-center gap-1.5 self-start sm:self-auto"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Restock All Low Items (+15)</span>
            </button>
          </div>

          <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950 text-slate-400 font-mono-code border-b border-slate-800">
                  <tr>
                    <th className="p-3.5">Item Name</th>
                    <th className="p-3.5">Category</th>
                    <th className="p-3.5">Price</th>
                    <th className="p-3.5">Current Stock</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5 text-right">Quick Restock</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono-code">
                  {customMenuItems.map((item) => {
                    const st = item.stock || 0;
                    const isLow = st <= 5 && st > 0;
                    const isOut = st <= 0;

                    return (
                      <tr key={item.id} className="hover:bg-slate-900/40 transition-colors">
                        <td className="p-3.5 font-sans font-bold text-white">{item.name}</td>
                        <td className="p-3.5 text-slate-400">{item.category}</td>
                        <td className="p-3.5 font-bold text-emerald-400">₹{Number(item.price).toFixed(2)}</td>
                        <td className="p-3.5">
                          <span className={`font-black text-sm ${isOut ? 'text-rose-400' : isLow ? 'text-amber-400' : 'text-white'}`}>
                            {st} units
                          </span>
                        </td>
                        <td className="p-3.5">
                          {isOut ? (
                            <span className="px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/30 text-[10px] font-bold">
                              Sold Out
                            </span>
                          ) : isLow ? (
                            <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 text-[10px] font-bold flex items-center gap-1 w-fit">
                              <AlertTriangle className="w-3 h-3" />
                              Low Stock
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold">
                              In Stock
                            </span>
                          )}
                        </td>
                        <td className="p-3.5 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              onClick={() => {
                                restockItem(item.id, 5);
                                addNotification('SYSTEM', '📦 Stock Added', `Added +5 units to ${item.name}.`);
                              }}
                              className="px-2 py-1 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white rounded border border-slate-800 text-[11px]"
                            >
                              +5
                            </button>
                            <button
                              onClick={() => {
                                restockItem(item.id, 10);
                                addNotification('SYSTEM', '📦 Stock Added', `Added +10 units to ${item.name}.`);
                              }}
                              className="px-2 py-1 bg-slate-900 hover:bg-slate-800 text-emerald-400 hover:text-emerald-300 rounded border border-slate-800 text-[11px] font-bold"
                            >
                              +10
                            </button>
                            <button
                              onClick={() => {
                                restockItem(item.id, 25);
                                addNotification('SYSTEM', '📦 Stock Added', `Added +25 units to ${item.name}.`);
                              }}
                              className="px-2 py-1 bg-slate-900 hover:bg-slate-800 text-cyan-400 hover:text-cyan-300 rounded border border-slate-800 text-[11px] font-bold"
                            >
                              +25
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
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
              {revenueData.chartData.map((d) => {
                const maxVal = Math.max(...revenueData.chartData.map((c) => c.total), 1000);
                const pct = Math.min(100, Math.max(8, (d.total / maxVal) * 100));

                return (
                  <div key={d.label} className="space-y-1">
                    <div className="flex justify-between text-xs font-mono-code">
                      <span className="text-slate-300 font-semibold">{d.label}</span>
                      <span className="text-white font-bold">₹{d.total.toFixed(2)}</span>
                    </div>
                    <div className="w-full bg-slate-900 rounded-full h-3 flex overflow-hidden">
                      <div
                        className="bg-emerald-500 h-full transition-all duration-500"
                        style={{ width: `${d.total > 0 ? (d.gaming / d.total) * pct : 0}%` }}
                        title={`Gaming: ₹${d.gaming}`}
                      />
                      <div
                        className="bg-amber-500 h-full transition-all duration-500"
                        style={{ width: `${d.total > 0 ? (d.food / d.total) * pct : 0}%` }}
                        title={`Food: ₹${d.food}`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: GAMES LIBRARY & CONSOLE OPTIONS */}
      {/* ========================================================================= */}
      {activeTab === 'GAMES' && (
        <div className="space-y-5">
          <div className="glass-panel p-4 sm:p-5 rounded-2xl border border-slate-800 space-y-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Gamepad2 className="w-4 h-4 text-emerald-400" />
              <span>Add Installed Game to Station / Platform</span>
            </h3>

            <form onSubmit={handleAddGame} className="flex flex-col sm:flex-row gap-3">
              <select
                value={selectedStationForGame}
                onChange={(e) => setSelectedStationForGame(e.target.value)}
                className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500 font-semibold"
              >
                <option value="default_ps5">All PS5 Consoles</option>
                <option value="default_pc">All RTX 4080 / 4090 Gaming PCs</option>
                <option value="default_sim">All Racing / Flight Simulators</option>
                {stations.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.name} ({st.tier})
                  </option>
                ))}
              </select>

              <input
                type="text"
                value={newGameTitle}
                onChange={(e) => setNewGameTitle(e.target.value)}
                placeholder="e.g. GTA V Enhanced, Resident Evil 4 Remake"
                className="flex-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
                required
              />

              <button
                type="submit"
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Game</span>
              </button>
            </form>
          </div>

          {/* Current Game Libraries per Platform */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* PS5 */}
            <div className="glass-panel p-4 rounded-2xl border border-slate-800 space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-violet-400"></span>
                  <h4 className="text-sm font-bold text-white font-display">PlayStation 5 Consoles</h4>
                </div>
                <span className="text-[11px] font-mono-code text-slate-400">
                  {(stationGames['default_ps5'] || []).length} Titles
                </span>
              </div>

              <div className="space-y-1.5">
                {(stationGames['default_ps5'] || []).map((game) => (
                  <div
                    key={game}
                    className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-950/70 border border-slate-800/80 text-xs text-slate-200"
                  >
                    <span>{game}</span>
                    <button
                      onClick={() => handleRemoveGame('default_ps5', game)}
                      className="text-slate-500 hover:text-rose-400 p-1"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* PC */}
            <div className="glass-panel p-4 rounded-2xl border border-slate-800 space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-cyan-400"></span>
                  <h4 className="text-sm font-bold text-white font-display">RTX Gaming PC Rigs</h4>
                </div>
                <span className="text-[11px] font-mono-code text-slate-400">
                  {(stationGames['default_pc'] || []).length} Titles
                </span>
              </div>

              <div className="space-y-1.5">
                {(stationGames['default_pc'] || []).map((game) => (
                  <div
                    key={game}
                    className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-950/70 border border-slate-800/80 text-xs text-slate-200"
                  >
                    <span>{game}</span>
                    <button
                      onClick={() => handleRemoveGame('default_pc', game)}
                      className="text-slate-500 hover:text-rose-400 p-1"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Simulators */}
            <div className="glass-panel p-4 rounded-2xl border border-slate-800 space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400"></span>
                  <h4 className="text-sm font-bold text-white font-display">Moza Racing / Flight Simulators</h4>
                </div>
                <span className="text-[11px] font-mono-code text-slate-400">
                  {(stationGames['default_sim'] || []).length} Titles
                </span>
              </div>

              <div className="space-y-1.5">
                {(stationGames['default_sim'] || []).map((game) => (
                  <div
                    key={game}
                    className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-950/70 border border-slate-800/80 text-xs text-slate-200"
                  >
                    <span>{game}</span>
                    <button
                      onClick={() => handleRemoveGame('default_sim', game)}
                      className="text-slate-500 hover:text-rose-400 p-1"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 5: CUSTOMER ADVANCE BOOKINGS QUEUE */}
      {/* ========================================================================= */}
      {activeTab === 'BOOKINGS' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">
              Customer Advance Reservations
            </h3>
            <span className="text-xs text-cyan-400 font-mono-code">
              {bookings.length} reservations recorded
            </span>
          </div>

          {bookings.length === 0 ? (
            <div className="glass-panel p-8 rounded-2xl border border-slate-800 text-center max-w-md mx-auto space-y-2">
              <CalendarClock className="w-8 h-8 text-slate-500 mx-auto" />
              <h4 className="text-sm font-bold text-white">No Upcoming Reservations</h4>
              <p className="text-xs text-slate-400">
                When customers place instant or advance bookings from their portal, they will appear here for staff verification and check-in.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {bookings.map((b) => (
                <div
                  key={b.id}
                  className="glass-panel p-4 rounded-2xl border border-cyan-500/30 space-y-2.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold font-mono-code text-cyan-400">
                      {b.id}
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                      Confirmed
                    </span>
                  </div>

                  <div>
                    <h4 className="text-sm font-bold text-white">{b.customerName}</h4>
                    <p className="text-xs text-slate-300 font-semibold">{b.stationName}</p>
                  </div>

                  <div className="bg-slate-950/70 p-2.5 rounded-xl border border-slate-800 text-xs space-y-1 font-mono-code">
                    <div className="flex justify-between text-slate-400">
                      <span>Scheduled:</span>
                      <span className="text-white font-semibold">{b.scheduledTime}</span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>Duration:</span>
                      <span className="text-slate-200">{b.durationMinutes / 60} hour(s)</span>
                    </div>
                    <div className="flex justify-between text-slate-400 border-t border-slate-800 pt-1">
                      <span>Rate:</span>
                      <span className="text-emerald-400 font-bold">₹{b.totalCost.toFixed(2)}</span>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => cancelBooking(b.id)}
                      className="flex-1 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white text-xs font-semibold"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => alert(`Player ${b.customerName} is now ready to play on ${b.stationName}!`)}
                      className="flex-1 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold flex items-center justify-center gap-1"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Check-In Now</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
