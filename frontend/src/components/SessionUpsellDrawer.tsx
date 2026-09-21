import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  X,
  Clock,
  Utensils,
  Plus,
  Minus,
  User,
  Phone,
  AlertCircle,
  Coffee,
  Gamepad2,
} from 'lucide-react';
import { StationLive, PricingTier, MenuItem } from '../types';
import { checkInStation, fetchAdminMenuItems, placeStationOrderApi } from '../api';
import { useAuthStore } from '../store/authStore';
import { useLoungeStore } from '../store/loungeStore';
import { useNotificationStore } from '../store/notificationStore';
import { SlideToConfirm } from './SlideToConfirm';

interface SessionUpsellDrawerProps {
  isOpen: boolean;
  station: StationLive | null;
  selectedTier: PricingTier | null;
  onClose: () => void;
  isAdmin?: boolean;
  defaultCustomerName?: string;
  defaultCustomerPhone?: string;
  onSuccess?: () => void;
}

export const SessionUpsellDrawer: React.FC<SessionUpsellDrawerProps> = ({
  isOpen,
  station,
  selectedTier,
  onClose,
  isAdmin = false,
  defaultCustomerName = '',
  defaultCustomerPhone = '',
  onSuccess,
}) => {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const { addBooking, recordCustomerVisit, addStationFoodOrder } = useLoungeStore();
  const { addNotification } = useNotificationStore();

  // Customer credentials
  const [customerName, setCustomerName] = useState(defaultCustomerName || user?.name || (isAdmin ? 'Walk-in Gamer' : 'Gamer'));
  const [customerPhone, setCustomerPhone] = useState(defaultCustomerPhone || user?.phone || '');

  // Snacks & Drinks Quantities: Record<itemId, number> (clamped between 0 and 5, default 0)
  const [snackQuantities, setSnackQuantities] = useState<Record<string, number>>({});
  const [activeSnackFilter, setActiveSnackFilter] = useState<'ALL' | 'Drinks' | 'Food'>('ALL');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch available snacks and drinks
  const { data: menuItems = [] } = useQuery<MenuItem[]>({
    queryKey: ['admin-menu'],
    queryFn: fetchAdminMenuItems,
    enabled: isOpen,
    staleTime: 10000,
  });

  const safeMenuItems = useMemo(() => {
    return (Array.isArray(menuItems) ? menuItems : []).filter(
      (item) => item?.is_available !== false && (item?.stock ?? 1) > 0
    );
  }, [menuItems]);

  // Duration and Base Price from Selected Tier
  const durationMinutes = Number(selectedTier?.duration_min || 60);
  const baseStationPrice = Number(
    selectedTier?.price !== undefined
      ? selectedTier.price
      : station?.default_hourly_rate || station?.hourly_rate || 180
  );

  // Reset states upon opening
  useEffect(() => {
    if (isOpen) {
      setCustomerName(defaultCustomerName || user?.name || (isAdmin ? 'Walk-in Gamer' : 'Gamer'));
      setCustomerPhone(defaultCustomerPhone || user?.phone || '');
      setSnackQuantities({});
      setActiveSnackFilter('ALL');
      setErrorMessage(null);
      setIsSubmitting(false);
    }
  }, [isOpen, defaultCustomerName, defaultCustomerPhone, user, isAdmin]);

  // Filtered snacks list
  const displayedSnacks = useMemo(() => {
    if (activeSnackFilter === 'ALL') return safeMenuItems;
    return safeMenuItems.filter((item) =>
      activeSnackFilter === 'Drinks'
        ? (item?.category || '').toLowerCase().includes('drink') || (item?.category || '').toLowerCase().includes('beverage') || (item?.category || '').toLowerCase().includes('coffee')
        : (item?.category || '').toLowerCase().includes('food') || (item?.category || '').toLowerCase().includes('snack') || (item?.category || '').toLowerCase().includes('meal')
    );
  }, [safeMenuItems, activeSnackFilter]);

  // Handle Stepper changes (clamped 0 to 5)
  const handleQuantityChange = (itemId: string, delta: number) => {
    setSnackQuantities((prev) => {
      const current = prev[itemId] || 0;
      const next = Math.max(0, Math.min(5, current + delta));
      if (next === 0) {
        const copy = { ...prev };
        delete copy[itemId];
        return copy;
      }
      return { ...prev, [itemId]: next };
    });
  };

  // Calculate live Snack total
  const selectedSnacksList = useMemo(() => {
    return Object.entries(snackQuantities)
      .map(([id, qty]) => {
        const item = safeMenuItems.find((m) => m.id === id);
        return {
          id,
          name: item?.name || 'Snack',
          category: item?.category || 'Snack',
          price: Number(item?.price || 0),
          quantity: qty,
          total: Number(item?.price || 0) * qty,
        };
      })
      .filter((i) => i.quantity > 0);
  }, [snackQuantities, safeMenuItems]);

  const snacksTotalCost = selectedSnacksList.reduce((sum, item) => sum + item.total, 0);
  const grandTotalCost = baseStationPrice + snacksTotalCost;

  // Session committal upon slide confirmation
  const handleConfirmSession = async () => {
    if (!station) return;
    setErrorMessage(null);

    const finalName = customerName.trim() || user?.name || (isAdmin ? 'Walk-in Gamer' : 'Gamer');
    const finalPhone = customerPhone.trim() || user?.phone || undefined;

    setIsSubmitting(true);
    try {
      // 1. Check in station session
      await checkInStation(
        station.id,
        durationMinutes,
        finalName,
        finalPhone,
        user?.id
      );

      // 2. If snacks were selected, place food order for this station
      if (selectedSnacksList.length > 0) {
        try {
          await placeStationOrderApi({
            station_id: station.id,
            items: selectedSnacksList.map((s) => ({
              menu_item_id: s.id,
              quantity: s.quantity,
            })),
            customer_name: finalName,
          });

          // Update local store for instant live bill breakdown
          addStationFoodOrder(station.name, selectedSnacksList);
        } catch (snackErr) {
          console.warn('Snack order placed with note:', snackErr);
        }
      }

      // 3. Record local visit & advance booking entry
      addBooking({
        stationId: station.id,
        stationName: station.name,
        customerName: finalName,
        customerPhone: finalPhone,
        bookingType: 'NOW',
        scheduledTime: 'Immediate Access',
        durationMinutes,
        hourlyRate: Number(station.hourly_rate || 180),
        totalCost: grandTotalCost,
        status: 'CONFIRMED',
      });

      recordCustomerVisit(finalName, finalPhone, grandTotalCost);

      // 4. Activity Log Notification
      addNotification(
        'BOOKING',
        '🎮 Session Started!',
        `${finalName} started ${station.name} for ${durationMinutes} mins (Total: ₹${grandTotalCost.toFixed(0)}).`
      );

      // 5. Invalidate server state across all views
      await queryClient.invalidateQueries({ queryKey: ['stations-live'] });
      await queryClient.invalidateQueries({ queryKey: ['kitchen-orders'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-menu'] });

      onSuccess?.();
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to start session. Please try again.');
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen || !station) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-[#0b101d] border border-slate-800/90 max-w-xl w-full rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden relative">
        {/* Drawer Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800/90 bg-slate-950/80 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
              <Gamepad2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-black font-display text-white tracking-wide">
                  Enhance Your Session
                </h3>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/15 border border-blue-500/30 text-blue-300 font-mono-code font-bold uppercase">
                  {station.name}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Pre-loaded with {durationMinutes} mins (₹{baseStationPrice}). Grab drinks or snacks below!
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {errorMessage && (
            <div className="p-3 rounded-2xl bg-rose-950/80 border border-rose-600/60 text-rose-200 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Session Overview Banner */}
          <div className="p-3.5 rounded-2xl bg-slate-950/90 border border-slate-800/80 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Clock className="w-4 h-4 text-cyan-400" />
              <div>
                <span className="text-xs font-bold text-white block">
                  {selectedTier?.label || `${durationMinutes} mins`} Console Time
                </span>
                <span className="text-[10px] text-slate-400 font-mono-code">
                  Base Rig Rate: ₹{baseStationPrice}
                </span>
              </div>
            </div>
            <div className="text-right">
              <span className="text-base font-black font-mono-code text-emerald-400">
                ₹{baseStationPrice}
              </span>
            </div>
          </div>

          {/* Admin Customer Inputs (Or Editable for walk-ins) */}
          {isAdmin && (
            <div className="p-3.5 rounded-2xl bg-slate-950/70 border border-slate-800/70 space-y-2.5">
              <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block font-mono-code">
                Front-Desk Player Details
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="relative">
                  <User className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-3" />
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Customer Name"
                    className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="relative">
                  <Phone className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-3" />
                  <input
                    type="tel"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    placeholder="10-digit Phone (optional)"
                    className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500 font-mono-code"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Quick-Grab Snacks & Drinks Section */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Utensils className="w-4 h-4 text-amber-400" />
                <h4 className="text-xs sm:text-sm font-bold text-white font-display uppercase tracking-wider">
                  Quick-Grab Snacks & Drinks
                </h4>
              </div>
              
              {/* Category Filter Pills */}
              <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-[11px] font-mono-code">
                {(['ALL', 'Drinks', 'Food'] as const).map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setActiveSnackFilter(cat)}
                    className={`px-2.5 py-0.5 rounded-lg font-bold transition-all ${
                      activeSnackFilter === cat
                        ? 'bg-slate-800 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Snacks Grid (Compact cards with 0-5 clamped stepper) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-56 overflow-y-auto pr-1">
              {displayedSnacks.length === 0 ? (
                <div className="col-span-2 p-6 text-center text-slate-500 font-mono-code text-xs">
                  No quick snacks currently in stock.
                </div>
              ) : (
                displayedSnacks.map((item) => {
                  const qty = snackQuantities[item.id] || 0;
                  const isDrink = (item.category || '').toLowerCase().includes('drink') || (item.category || '').toLowerCase().includes('beverage');

                  return (
                    <div
                      key={item.id}
                      className={`p-3 rounded-2xl border transition-all flex items-center justify-between gap-2 ${
                        qty > 0
                          ? 'bg-slate-900 border-amber-500/40 shadow-sm'
                          : 'bg-slate-950/80 border-slate-800/80 hover:border-slate-700'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          {isDrink ? (
                            <Coffee className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                          ) : (
                            <Utensils className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          )}
                          <span className="font-bold text-white text-xs truncate">
                            {item.name}
                          </span>
                        </div>
                        <div className="text-[11px] font-mono-code text-emerald-400 font-semibold mt-0.5">
                          ₹{Number(item.price).toFixed(0)}
                        </div>
                      </div>

                      {/* Stepper (Clamped 0 to 5) */}
                      <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-xl p-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleQuantityChange(item.id, -1)}
                          disabled={qty <= 0}
                          className="w-6 h-6 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-30 disabled:hover:bg-slate-800 flex items-center justify-center transition-colors"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="w-5 text-center font-mono-code text-xs font-bold text-white">
                          {qty}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleQuantityChange(item.id, 1)}
                          disabled={qty >= 5}
                          className="w-6 h-6 rounded-lg bg-amber-500/20 hover:bg-amber-500 hover:text-black text-amber-300 disabled:opacity-30 flex items-center justify-center transition-colors"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Sticky Drawer Footer with Live Bill Breakdown & Slide-to-Confirm */}
        <div className="p-4 sm:p-5 border-t border-slate-800/90 bg-slate-950/95 space-y-3 shrink-0">
          {/* Live Calculated Breakdown */}
          <div className="flex items-center justify-between text-xs font-mono-code px-1 text-slate-300">
            <div>
              Station: <strong className="text-white">₹{baseStationPrice}</strong>
              {snacksTotalCost > 0 && (
                <>
                  {' '}| Snacks: <strong className="text-amber-400">₹{snacksTotalCost}</strong>
                </>
              )}
            </div>
            <div className="text-sm font-black text-emerald-400">
              Total: ₹{grandTotalCost}
            </div>
          </div>

          {/* Slide-to-Confirm Knob */}
          <SlideToConfirm
            onConfirm={handleConfirmSession}
            isLoading={isSubmitting}
            label={`SLIDE TO START • ₹${grandTotalCost}`}
            confirmedLabel="SESSION ACTIVE!"
          />
        </div>
      </div>
    </div>
  );
};
