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
    onSuccess: async () => {
      // Refresh DB data everywhere immediately
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['stations-live'] }),
        queryClient.refetchQueries({ queryKey: ['station-matrix'] }),
        queryClient.refetchQueries({ queryKey: ['admin-customers'] }),
        queryClient.refetchQueries({ queryKey: ['customer-sessions'] }),
        queryClient.refetchQueries({ queryKey: ['kitchen-orders'] }),
        queryClient.refetchQueries({ queryKey: ['admin-menu'] }),
      ]);

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

  const safeMenuItems = Array.isArray(menuItems) ? menuItems : [];

  const availableItems = useMemo(() => {
    return safeMenuItems.filter((item) => {
      const matchCat =
        selectedCategory === 'ALL'
          ? true
          : (item?.category || '').toLowerCase() === selectedCategory.toLowerCase();
      const matchSearch =
        (item?.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (item?.category || '').toLowerCase().includes(searchQuery.toLowerCase());
      // Food order menu reflects directly from kitchen menu (available items), not inventory stock
      const isAvailable = item?.is_available !== false;
      return matchCat && matchSearch && isAvailable;
    });
  }, [safeMenuItems, selectedCategory, searchQuery]);

  if (!isOpen || !station) return null;

  const handleUpdateQuantity = (itemId: string, delta: number) => {
    setCart((prev) => {
      const current = prev[itemId] || 0;
      const next = Math.max(0, Math.min(99, current + delta));
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
      const found = safeMenuItems.find((m) => m?.id === id);
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
    try {
      if (selectedItemsList.length === 0) {
        setError('Please add at least one item to order.');
        return;
      }

      // Call backend API to save order in DB and decrement inventory stock atomically (if tracked)
      orderMutation.mutate({
        station_id: station.id,
        session_id: station.active_session_id,
        items: selectedItemsList.map((i) => ({
          menu_item_id: i.id,
          quantity: i.quantity,
        })),
        customer_name: user?.name || station.customer_name || 'Customer',
      });
    } catch (err: any) {
      setError(err?.message || 'Failed to place order.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-[#FFFFFF] border border-[#E2E8F0] max-w-lg w-full rounded-t-3xl sm:rounded-2xl p-5 sm:p-6 shadow-2xl relative animate-in slide-in-from-bottom-5 sm:zoom-in-95 max-h-[90vh] flex flex-col pb-safe">
        {/* Modal Header */}
        <div className="flex justify-between items-center pb-3 border-b border-[#E2E8F0] shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="w-10 h-10 rounded-xl bg-[#FFF7ED] border border-[#FED7AA] flex items-center justify-center text-[#EA580C]">
              <Utensils className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-[#0F172A] font-['Plus_Jakarta_Sans',sans-serif]">
                Order Food & Drinks
              </h3>
              <p className="text-xs text-[#64748B]">
                Station: <strong className="text-[#172554]">{station.name}</strong>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#64748B] hover:text-[#0F172A] p-1 rounded-lg hover:bg-[#F8FAFC] transition-colors"
          >
            <XCircle className="w-6 h-6" />
          </button>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mt-3 p-2.5 rounded-xl bg-red-50 border border-red-200 text-[#B91C1C] text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-[#B91C1C]" />
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
                    ? 'bg-[#EA580C] text-white font-bold shadow-sm'
                    : 'bg-[#FFFFFF] text-[#64748B] hover:text-[#0F172A] border border-[#E2E8F0]'
                }`}
              >
                {cat === 'ALL' ? 'All Items' : cat}
              </button>
            ))}
          </div>

          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-[#94A3B8]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search snacks, drinks..."
              className="w-full pl-8 pr-3 py-1.5 bg-[#FFFFFF] border border-[#E2E8F0] rounded-xl text-xs text-[#0F172A] placeholder-[#94A3B8] focus:outline-none focus:border-[#EA580C]"
            />
          </div>
        </div>

        {/* Menu Items List */}
        <div className="flex-1 overflow-y-auto space-y-2 py-2 pr-1 min-h-[220px] max-h-[360px]">
          {availableItems.length === 0 ? (
            <div className="text-center py-10 text-[#64748B] text-xs flex flex-col items-center justify-center space-y-2">
              <ShoppingBag className="w-7 h-7 text-[#94A3B8]" />
              <p>No food or drink items available in this category.</p>
            </div>
          ) : (
            availableItems.map((item) => {
              const qty = cart[item.id] || 0;
              return (
                <div
                  key={item.id}
                  className={`p-3 rounded-xl border transition-all flex items-center justify-between gap-3 ${
                    qty > 0
                      ? 'bg-[#FFF7ED] border-[#EA580C]'
                      : 'bg-[#FFFFFF] border-[#E2E8F0] hover:border-[#CBD5E1]'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-[#0F172A] truncate">
                        {item.name}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#F1F5F9] text-[#64748B] font-mono">
                        {item.category}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs">
                      <span className="font-mono font-bold text-[#172554]">
                        ₹{Number(item.price).toFixed(2)}
                      </span>
                      <span className="text-[10px] text-[#64748B]">
                        {item.stock !== undefined && item.stock !== null && item.stock > 0 ? (
                          <>Stock: <strong className="text-[#15803D] font-mono">{item.stock}</strong></>
                        ) : (
                          <span className="text-[#EA580C] font-medium">Kitchen Prepared</span>
                        )}
                      </span>
                    </div>
                  </div>

                  {/* Quantity Stepper */}
                  <div className="flex items-center gap-2 shrink-0">
                    {qty > 0 ? (
                      <div className="flex items-center gap-2 bg-[#FFFFFF] p-1 rounded-xl border border-[#FED7AA]">
                        <button
                          type="button"
                          onClick={() => handleUpdateQuantity(item.id, -1)}
                          className="w-7 h-7 rounded-lg bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#0F172A] flex items-center justify-center transition-colors"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="w-5 text-center text-xs font-bold font-mono text-[#0F172A]">
                          {qty}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleUpdateQuantity(item.id, 1)}
                          className="w-7 h-7 rounded-lg bg-[#EA580C] hover:bg-[#C2410C] text-white flex items-center justify-center transition-colors font-bold"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleUpdateQuantity(item.id, 1)}
                        className="px-3.5 py-1.5 rounded-xl bg-[#FFF7ED] hover:bg-[#EA580C] text-[#EA580C] hover:text-white text-xs font-bold transition-colors flex items-center gap-1 border border-[#FED7AA] hover:border-[#EA580C]"
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
        <div className="pt-3 border-t border-[#E2E8F0] shrink-0 space-y-3 mt-2">
          <div className="flex justify-between items-center text-xs bg-[#F8FAFC] p-3 rounded-xl border border-[#E2E8F0]">
            <span className="text-[#64748B]">
              Selected: <strong className="text-[#0F172A] font-mono">{totalItemsCount} item(s)</strong>
            </span>
            <span className="text-[#64748B]">
              Total: <strong className="text-[#172554] text-base font-mono font-bold">₹{totalCost.toFixed(2)}</strong>
            </span>
          </div>

          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 min-h-[44px] rounded-xl bg-[#FFFFFF] hover:bg-[#F1F5F9] text-[#64748B] text-xs font-semibold border border-[#E2E8F0] transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={totalItemsCount === 0 || orderMutation.isPending}
              onClick={handleConfirmOrder}
              className="flex-1 py-3 min-h-[44px] rounded-xl bg-[#EA580C] hover:bg-[#C2410C] text-white font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-sm flex items-center justify-center gap-2"
            >
              <Utensils className="w-4 h-4 text-white" />
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
