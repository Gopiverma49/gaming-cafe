import React, { useState, useEffect, useMemo } from 'react';
import {
  Utensils,
  XCircle,
  Plus,
  Minus,
  Search,
  AlertCircle,
  ShoppingBag,
} from 'lucide-react';
import { StationLive, MenuItem } from '../types';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchAdminMenuItems, placeStationOrderApi } from '../api';
import { useAuthStore } from '../store/authStore';
import { useLoungeStore } from '../store/loungeStore';
import { useNotificationStore } from '../store/notificationStore';

interface StationFoodOrderModalProps {
  isOpen: boolean;
  station: StationLive | null;
  onClose: () => void;
  isAdmin?: boolean;
  onSuccess?: () => void;
}

export const StationFoodOrderModal: React.FC<StationFoodOrderModalProps> = ({
  isOpen,
  station,
  onClose,
  isAdmin = false,
  onSuccess,
}) => {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const { addStationFoodOrder } = useLoungeStore();
  const { addNotification } = useNotificationStore();

  const [cart, setCart] = useState<Record<string, number>>({});
  const [selectedCategory, setSelectedCategory] = useState<'ALL' | 'Food' | 'Drinks'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Fetch real menu items with live stock from Database
  const { data: menuItems = [] } = useQuery<MenuItem[]>({
    queryKey: ['admin-menu'],
    queryFn: fetchAdminMenuItems,
    enabled: isOpen,
  });

  const orderMutation = useMutation({
    mutationFn: placeStationOrderApi,
    onSuccess: () => {
      // Refresh DB data everywhere
      queryClient.invalidateQueries({ queryKey: ['admin-menu'] });
      queryClient.invalidateQueries({ queryKey: ['stations-live'] });
      queryClient.invalidateQueries({ queryKey: ['kitchen-orders'] });

      addNotification(
        'FOOD_ORDER',
        `🍽️ Food Order: ${station?.name}`,
        `Order saved to DB! Stock decremented for ${totalItemsCount} item(s) (₹${totalCost.toFixed(2)}).`
      );

      onSuccess?.();
      onClose();
    },
    onError: (err: any) => {
      setError(err.message || 'Failed to place order in database.');
    },
  });

  useEffect(() => {
    if (isOpen) {
      setCart({});
      setSelectedCategory('ALL');
      setSearchQuery('');
      setError(null);
    }
  }, [isOpen]);

  const availableItems = useMemo(() => {
    return menuItems.filter((item) => {
      const matchCat =
        selectedCategory === 'ALL'
          ? true
          : item.category.toLowerCase() === selectedCategory.toLowerCase();
      const matchSearch =
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.category.toLowerCase().includes(searchQuery.toLowerCase());
      const isAvailable = item.is_available !== false && (item.stock ?? 1) > 0;
      return matchCat && matchSearch && isAvailable;
    });
  }, [menuItems, selectedCategory, searchQuery]);

  if (!isOpen || !station) return null;

  const handleUpdateQuantity = (itemId: string, delta: number) => {
    const itemObj = menuItems.find((m) => m.id === itemId);
    const maxStock = itemObj?.stock ?? 999;

    setCart((prev) => {
      const current = prev[itemId] || 0;
      const next = Math.max(0, Math.min(maxStock, current + delta));
      if (next === 0) {
        const copy = { ...prev };
        delete copy[itemId];
        return copy;
      }
      return { ...prev, [itemId]: next };
    });
  };

  const selectedItemsList = Object.entries(cart)
    .map(([id, quantity]) => {
      const found = menuItems.find((m) => m.id === id);
      return {
        id,
        name: found?.name || 'Food Item',
        category: found?.category || 'Food',
        price: Number(found?.price || 0),
        quantity,
      };
    })
    .filter((i) => i.quantity > 0);

  const totalItemsCount = selectedItemsList.reduce((sum, i) => sum + i.quantity, 0);
  const totalCost = selectedItemsList.reduce((sum, i) => sum + i.quantity * i.price, 0);

  const handleConfirmOrder = () => {
    if (selectedItemsList.length === 0) {
      setError('Please add at least one item to order.');
      return;
    }

    // Call backend API to save order in DB and decrement inventory stock atomically
    orderMutation.mutate({
      station_id: station.id,
      items: selectedItemsList.map((i) => ({
        menu_item_id: i.id,
        quantity: i.quantity,
      })),
      customer_name: user?.name || 'Customer',
    });

    // Also update lounge store for immediate UI feedback
    addStationFoodOrder(station.name, selectedItemsList);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-slate-900 border border-amber-500/40 max-w-lg w-full rounded-t-3xl sm:rounded-3xl p-5 sm:p-6 shadow-2xl relative animate-in slide-in-from-bottom-5 sm:zoom-in-95 max-h-[90vh] flex flex-col pb-safe">
        {/* Modal Header */}
        <div className="flex justify-between items-center pb-3 border-b border-slate-800 shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Utensils className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-white font-display">
                Order Food & Drinks
              </h3>
              <p className="text-xs text-amber-400/90 font-mono-code">
                Station: <strong className="text-white">{station.name}</strong>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <XCircle className="w-6 h-6" />
          </button>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mt-3 p-2.5 rounded-xl bg-rose-950/80 border border-rose-600/70 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        {/* Category Filter Pills & Search */}
        <div className="pt-3 pb-2 flex flex-col sm:flex-row gap-2.5 shrink-0">
          <div className="flex items-center gap-1.5">
            {(['ALL', 'Food', 'Drinks'] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                  selectedCategory === cat
                    ? 'bg-amber-500 text-slate-950 font-bold shadow-md shadow-amber-500/20'
                    : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
                }`}
              >
                {cat === 'ALL' ? 'All Items' : cat}
              </button>
            ))}
          </div>

          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search snacks, drinks..."
              className="w-full pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-amber-500"
            />
          </div>
        </div>

        {/* Menu Items List */}
        <div className="flex-1 overflow-y-auto space-y-2 py-2 pr-1 min-h-[220px] max-h-[360px]">
          {availableItems.length === 0 ? (
            <div className="text-center py-10 text-slate-500 text-xs flex flex-col items-center justify-center space-y-2">
              <ShoppingBag className="w-7 h-7 text-slate-600" />
              <p>No food or drink items available in this category.</p>
            </div>
          ) : (
            availableItems.map((item) => {
              const qty = cart[item.id] || 0;
              return (
                <div
                  key={item.id}
                  className={`p-3 rounded-2xl border transition-all flex items-center justify-between gap-3 ${
                    qty > 0
                      ? 'bg-amber-950/40 border-amber-500/50'
                      : 'bg-slate-950/70 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-white truncate">
                        {item.name}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono-code">
                        {item.category}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs">
                      <span className="font-mono-code font-bold text-amber-400">
                        ₹{Number(item.price).toFixed(2)}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        Stock: <strong className="text-slate-300 font-mono-code">{item.stock ?? 20}</strong>
                      </span>
                    </div>
                  </div>

                  {/* Quantity Stepper */}
                  <div className="flex items-center gap-2 shrink-0">
                    {qty > 0 ? (
                      <div className="flex items-center gap-2 bg-slate-900 p-1 rounded-xl border border-amber-500/40">
                        <button
                          type="button"
                          onClick={() => handleUpdateQuantity(item.id, -1)}
                          className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-white flex items-center justify-center transition-colors"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="w-5 text-center text-xs font-bold font-mono-code text-white">
                          {qty}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleUpdateQuantity(item.id, 1)}
                          className="w-7 h-7 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 flex items-center justify-center transition-colors font-bold"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleUpdateQuantity(item.id, 1)}
                        className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-amber-500 hover:text-slate-950 text-slate-300 text-xs font-bold transition-colors flex items-center gap-1 border border-slate-700 hover:border-amber-500"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Modal Footer */}
        <div className="pt-3 border-t border-slate-800 shrink-0 space-y-3 mt-2">
          <div className="flex justify-between items-center text-xs bg-slate-950/90 p-3 rounded-xl border border-slate-800">
            <span className="text-slate-400">
              Selected: <strong className="text-white font-mono-code">{totalItemsCount} item(s)</strong>
            </span>
            <span className="text-slate-400">
              Total: <strong className="text-amber-400 text-base font-mono-code">₹{totalCost.toFixed(2)}</strong>
            </span>
          </div>

          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 min-h-[44px] rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={totalItemsCount === 0 || orderMutation.isPending}
              onClick={handleConfirmOrder}
              className="flex-1 py-3 min-h-[44px] rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2"
            >
              <Utensils className="w-4 h-4 text-slate-950" />
              <span>
                {orderMutation.isPending
                  ? 'Placing Order...'
                  : isAdmin
                  ? 'Add to Station Bill'
                  : 'Place Order'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
