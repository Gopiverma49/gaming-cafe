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
  Sparkles,
  Cpu,
} from 'lucide-react';
import { StationLive, PricingTier, MenuItem, CategoryAvailability } from '../types';
import { checkInStation, fetchAdminMenuItems, placeStationOrderApi, startCategorySessionApi, fetchFleetCategories } from '../api';
import { useAuthStore } from '../store/authStore';
import { useLoungeStore } from '../store/loungeStore';
import { useNotificationStore } from '../store/notificationStore';
import { SlideToConfirm } from './SlideToConfirm';

interface SessionUpsellDrawerProps {
  isOpen: boolean;
  station?: StationLive | null;
  category?: CategoryAvailability | null;
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
  category,
  selectedTier,
  onClose,
  isAdmin = false,
  defaultCustomerName = '',
  defaultCustomerPhone = '',
  onSuccess,
}) => {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const { addBooking, recordCustomerVisit } = useLoungeStore();
  const { addNotification } = useNotificationStore();

  // Selected hardware device when booking a Category (Solo/Multiplayer -> PS1, PS2, PS3)
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('PS1');

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

  // Fetch Experience Categories to ensure live device/console availability
  const { data: fleetCategories = [] } = useQuery<CategoryAvailability[]>({
    queryKey: ['fleet-categories'],
    queryFn: fetchFleetCategories,
    enabled: isOpen,
    staleTime: 5000,
  });

  // Effective category resolution (whether opened via matrix station or category)
  const effectiveCategory = useMemo<CategoryAvailability | null>(() => {
    if (category) return category;
    if (!station) return null;
    const nameLower = (station.name || '').toLowerCase();
    const found = fleetCategories.find(
      (c) =>
        c.name.toLowerCase() === nameLower ||
        c.id.toLowerCase() === nameLower ||
        (nameLower.includes('car') && c.id === 'car_sim') ||
        (nameLower.includes('vr') && c.id === 'vr_sim') ||
        (nameLower.includes('multi') && c.id === 'multiplayer') ||
        (nameLower.includes('solo') && c.id === 'solo')
    );
    if (found) return found;

    if (nameLower.includes('multi')) {
      return {
        id: 'multiplayer',
        name: 'Multiplayer',
        tier: 'CONSOLE',
        supported_device_ids: ['PS1', 'PS2', 'PS3'],
        devices: [
          { id: 'PS1', name: 'PS1', is_occupied: false },
          { id: 'PS2', name: 'PS2', is_occupied: false },
          { id: 'PS3', name: 'PS3', is_occupied: false },
        ],
        total_units: 3,
        available_units: 3,
        is_available: true,
        hourly_rate: Number(station.hourly_rate || 220),
      };
    }
    if (nameLower.includes('car')) {
      return {
        id: 'car_sim',
        name: 'Car Simulator',
        tier: 'SIMULATOR',
        supported_device_ids: ['PS3'],
        devices: [{ id: 'PS3', name: 'PS3', is_occupied: false }],
        total_units: 1,
        available_units: 1,
        is_available: true,
        hourly_rate: Number(station.hourly_rate || 250),
      };
    }
    if (nameLower.includes('vr')) {
      return {
        id: 'vr_sim',
        name: 'VR',
        tier: 'VR',
        supported_device_ids: ['VR1'],
        devices: [{ id: 'VR1', name: 'VR1', is_occupied: false }],
        total_units: 1,
        available_units: 1,
        is_available: true,
        hourly_rate: Number(station.hourly_rate || 300),
      };
    }
    return {
      id: 'solo',
      name: 'Solo',
      tier: 'CONSOLE',
      supported_device_ids: ['PS1', 'PS2', 'PS3'],
      devices: [
        { id: 'PS1', name: 'PS1', is_occupied: false },
        { id: 'PS2', name: 'PS2', is_occupied: false },
        { id: 'PS3', name: 'PS3', is_occupied: false },
      ],
      total_units: 3,
      available_units: 3,
      is_available: true,
      hourly_rate: Number(station.hourly_rate || 180),
    };
  }, [category, station, fleetCategories]);

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
      : effectiveCategory?.hourly_rate || station?.default_hourly_rate || station?.hourly_rate || 180
  );

  const isConsoleCategory = effectiveCategory && (effectiveCategory.id.toLowerCase() === 'solo' || effectiveCategory.id.toLowerCase() === 'multiplayer');
  const isCarSim = effectiveCategory && effectiveCategory.id.toLowerCase() === 'car_sim';
  const isVrSim = effectiveCategory && (effectiveCategory.id.toLowerCase() === 'vr_sim' || effectiveCategory.id.toLowerCase() === 'vr');

  // Reset states upon opening
  useEffect(() => {
    if (isOpen) {
      setCustomerName(defaultCustomerName || user?.name || (isAdmin ? 'Walk-in Gamer' : 'Gamer'));
      setCustomerPhone(defaultCustomerPhone || user?.phone || '');
      setSnackQuantities({});
      setActiveSnackFilter('ALL');
      setErrorMessage(null);
      setIsSubmitting(false);

      if (effectiveCategory) {
        if (effectiveCategory.id.toLowerCase() === 'car_sim') {
          setSelectedDeviceId('PS3');
        } else if (effectiveCategory.id.toLowerCase() === 'vr_sim' || effectiveCategory.id.toLowerCase() === 'vr') {
          setSelectedDeviceId('VR1');
        } else if (Array.isArray(effectiveCategory.devices) && effectiveCategory.devices.length > 0) {
          const firstFree = effectiveCategory.devices.find((d) => !d.is_occupied);
          setSelectedDeviceId(firstFree ? firstFree.id : effectiveCategory.devices[0].id);
        } else {
          setSelectedDeviceId(effectiveCategory.name || 'PS1');
        }
      }
    }
  }, [isOpen, defaultCustomerName, defaultCustomerPhone, user, isAdmin, effectiveCategory]);

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
        if (!item) return null;
        return {
          id: item.id,
          name: item.name,
          category: item.category,
          price: Number(item.price || 0),
          quantity: qty,
          subtotal: Number(item.price || 0) * qty,
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);
  }, [snackQuantities, safeMenuItems]);

  const snacksSubtotal = selectedSnacksList.reduce((acc, itm) => acc + itm.subtotal, 0);
  const snacksTotalCost = snacksSubtotal;
  const grandTotalCost = baseStationPrice + snacksSubtotal;

  // Session committal upon slide confirmation
  const handleConfirmSession = async () => {
    if (!station && !effectiveCategory) return;
    setErrorMessage(null);

    const finalName = customerName.trim() || user?.name || (isAdmin ? 'Walk-in Gamer' : 'Gamer');
    const finalPhone = customerPhone.trim() || user?.phone || undefined;

    setIsSubmitting(true);
    try {
      let targetStationId: string;
      let targetStationName: string;

      const targetCatId = effectiveCategory?.id || station?.id || (station?.name.toLowerCase().includes('multi') ? 'multiplayer' : station?.name.toLowerCase().includes('car') ? 'car_sim' : station?.name.toLowerCase().includes('vr') ? 'vr_sim' : 'solo');

      // Shared-resource device allocation route
      try {
        const sessionResult = await startCategorySessionApi({
          category_id: targetCatId,
          device_id: selectedDeviceId,
          duration_minutes: durationMinutes,
          customer_name: finalName,
          customer_phone: finalPhone,
          user_id: user?.id,
          tier_price: baseStationPrice,
        });
        targetStationId = sessionResult.station_id;
        targetStationName = sessionResult.station_name || sessionResult.station || effectiveCategory?.name || selectedDeviceId;
      } catch (catErr: any) {
        if (station) {
          const checkInRes = await checkInStation(
            station.id,
            durationMinutes,
            finalName,
            finalPhone,
            user?.id,
            baseStationPrice,
            selectedDeviceId
          );
          targetStationId = checkInRes.station_id || station.id;
          targetStationName = station.name;
        } else {
          throw catErr;
        }
      }

      // 2. If snacks were selected, place food order for this station
      if (selectedSnacksList.length > 0) {
        try {
          await placeStationOrderApi({
            station_id: targetStationId,
            items: selectedSnacksList.map((s) => ({
              menu_item_id: s.id,
              quantity: s.quantity,
            })),
            customer_name: finalName,
          });
        } catch (snackErr) {
          console.warn('Snack order placed with note:', snackErr);
        }
      }

      // 3. Record local visit & advance booking entry
      addBooking({
        stationId: targetStationId,
        stationName: targetStationName,
        customerName: finalName,
        customerPhone: finalPhone,
        bookingType: 'NOW',
        scheduledTime: 'Immediate Access',
        durationMinutes,
        hourlyRate: Number(effectiveCategory?.hourly_rate || category?.hourly_rate || station?.hourly_rate || 180),
        totalCost: grandTotalCost,
        status: 'CONFIRMED',
      });

      recordCustomerVisit(finalName, finalPhone, grandTotalCost);

      // 4. Activity Log Notification
      addNotification(
        'BOOKING',
        '🎮 Session Started!',
        `${finalName} started ${targetStationName} for ${durationMinutes} mins (Total: ₹${grandTotalCost.toFixed(0)}).`
      );

      // 5. Invalidate & immediately refetch server state across all views
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['station-matrix'] }),
        queryClient.refetchQueries({ queryKey: ['station-matrix'] }),
        queryClient.refetchQueries({ queryKey: ['stations-live'] }),
        queryClient.refetchQueries({ queryKey: ['fleet-categories'] }),
        queryClient.refetchQueries({ queryKey: ['customer-sessions'] }),
        queryClient.refetchQueries({ queryKey: ['kitchen-orders'] }),
        queryClient.refetchQueries({ queryKey: ['admin-menu'] }),
        queryClient.refetchQueries({ queryKey: ['admin-customers'] }),
      ]);

      onSuccess?.();
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to start session. Please try again.');
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen || (!station && !category && !effectiveCategory)) return null;

  const displayName = effectiveCategory?.name || category?.name || station?.name || 'Station';

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
      <div className="bg-[#FFFFFF] border border-[#E2E8F0] max-w-xl w-full rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden relative">
        {/* Drawer Header */}
        <div className="p-4 sm:p-5 border-b border-[#E2E8F0] bg-[#FFF7ED] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#172554] flex items-center justify-center text-white shadow-sm">
              <Gamepad2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-bold font-['Plus_Jakarta_Sans',sans-serif] text-[#172554] tracking-wide">
                  Enhance Your Session
                </h3>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#FFF7ED] border border-[#FED7AA] text-[#EA580C] font-mono font-bold uppercase">
                  {displayName}
                </span>
              </div>
              <p className="text-xs text-[#64748B]">
                Pre-loaded with {durationMinutes} mins (₹{baseStationPrice}). Grab drinks or snacks below!
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-[#64748B] hover:text-[#0F172A] rounded-xl hover:bg-[#F1F5F9] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {errorMessage && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-[#B91C1C] text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-[#B91C1C] shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Hardware Console / Rig Selector for Experience Categories */}
          {effectiveCategory && (
            <div className="bg-[#F8FAFC] p-3.5 rounded-xl border border-[#E2E8F0] space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#172554] font-bold uppercase tracking-wider font-mono flex items-center gap-1.5">
                  <Gamepad2 className="w-3.5 h-3.5 text-[#EA580C]" />
                  <span>HARDWARE ASSET ALLOCATION:</span>
                </span>
                {isConsoleCategory && (
                  <span className="text-[11px] text-[#64748B]">Pick an available console room</span>
                )}
              </div>

              {isConsoleCategory && (
                <div className="grid grid-cols-3 gap-2">
                  {effectiveCategory.devices.map((dev) => {
                    const isSelected = selectedDeviceId === dev.id;
                    const isBusy = dev.is_occupied;
                    return (
                      <button
                        key={dev.id}
                        type="button"
                        disabled={isBusy}
                        onClick={() => setSelectedDeviceId(dev.id)}
                        className={`py-2 px-2.5 rounded-xl border font-bold text-xs flex flex-col items-center justify-center gap-0.5 transition-all ${
                          isBusy
                            ? 'bg-[#F1F5F9] border-[#E2E8F0] text-[#94A3B8] cursor-not-allowed line-through'
                            : isSelected
                            ? 'bg-[#FFF7ED] border-[#EA580C] text-[#EA580C] shadow-sm'
                            : 'bg-[#FFFFFF] border-[#E2E8F0] text-[#0F172A] hover:border-[#CBD5E1] cursor-pointer'
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              isBusy ? 'bg-[#B91C1C]' : isSelected ? 'bg-[#EA580C] animate-pulse' : 'bg-[#15803D]'
                            }`}
                          />
                          <span className="font-['Plus_Jakarta_Sans',sans-serif]">{dev.name}</span>
                        </div>
                        <span className="text-[10px] font-mono font-normal">
                          {isBusy ? 'Busy' : isSelected ? 'Selected' : 'Available'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {isCarSim && (
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#FFF7ED] border border-[#FED7AA] text-xs">
                  <span className="text-[#EA580C] font-semibold flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-[#EA580C]" />
                    <span>Rig Allocation: Dedicated PS3 Racing Simulator</span>
                  </span>
                  <span className="font-mono text-[11px] text-[#15803D] font-bold px-2 py-0.5 rounded bg-emerald-50">
                    Locked to PS3
                  </span>
                </div>
              )}

              {isVrSim && (
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-teal-50 border border-teal-200 text-xs">
                  <span className="text-teal-700 font-semibold flex items-center gap-1.5">
                    <Cpu className="w-3.5 h-3.5 text-teal-600" />
                    <span>Rig Allocation: Dedicated VR1 Headset</span>
                  </span>
                  <span className="font-mono text-[11px] text-[#15803D] font-bold px-2 py-0.5 rounded bg-emerald-50">
                    Locked to VR1
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Session Overview Banner */}
          <div className="p-3.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Clock className="w-4 h-4 text-[#EA580C]" />
              <div>
                <span className="text-xs font-bold text-[#0F172A] block font-['Plus_Jakarta_Sans',sans-serif]">
                  {selectedTier?.label || `${durationMinutes} mins`} Console Time
                </span>
                <span className="text-[10px] text-[#64748B] font-mono">
                  Base Rig Rate: ₹{baseStationPrice}
                </span>
              </div>
            </div>
            <div className="text-right">
              <span className="text-base font-black font-mono text-[#172554]">
                ₹{baseStationPrice}
              </span>
            </div>
          </div>

          {/* Admin Customer Inputs (Or Editable for walk-ins) */}
          {isAdmin && (
            <div className="p-3.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] space-y-2.5">
              <span className="text-[11px] font-bold text-[#172554] uppercase tracking-wider block font-mono">
                Front-Desk Player Details
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="relative">
                  <User className="w-3.5 h-3.5 text-[#94A3B8] absolute left-3 top-3" />
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Customer Name"
                    className="w-full pl-9 pr-3 py-2 bg-[#FFFFFF] border border-[#E2E8F0] rounded-xl text-xs text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:border-[#EA580C]"
                  />
                </div>
                <div className="relative">
                  <Phone className="w-3.5 h-3.5 text-[#94A3B8] absolute left-3 top-3" />
                  <input
                    type="tel"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    placeholder="10-digit Phone (optional)"
                    className="w-full pl-9 pr-3 py-2 bg-[#FFFFFF] border border-[#E2E8F0] rounded-xl text-xs text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:border-[#EA580C] font-mono"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Quick-Grab Snacks & Drinks Section */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Utensils className="w-4 h-4 text-[#EA580C]" />
                <h4 className="text-xs sm:text-sm font-bold text-[#172554] font-['Plus_Jakarta_Sans',sans-serif] uppercase tracking-wider">
                  Quick-Grab Snacks & Drinks
                </h4>
              </div>
              
              {/* Category Filter Pills */}
              <div className="flex items-center gap-1 bg-[#F8FAFC] p-1 rounded-xl border border-[#E2E8F0] text-[11px] font-mono">
                {(['ALL', 'Drinks', 'Food'] as const).map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setActiveSnackFilter(cat)}
                    className={`px-2.5 py-0.5 rounded-lg font-bold transition-all ${
                      activeSnackFilter === cat
                        ? 'bg-[#EA580C] text-white shadow-sm'
                        : 'text-[#64748B] hover:text-[#0F172A]'
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
                <div className="col-span-2 p-6 text-center text-[#64748B] font-mono text-xs">
                  No quick snacks currently in stock.
                </div>
              ) : (
                displayedSnacks.map((item) => {
                  const qty = snackQuantities[item.id] || 0;
                  const isDrink = (item.category || '').toLowerCase().includes('drink') || (item.category || '').toLowerCase().includes('beverage');

                  return (
                    <div
                      key={item.id}
                      className={`p-3 rounded-xl border transition-all flex items-center justify-between gap-2 ${
                        qty > 0
                          ? 'bg-[#FFF7ED] border-[#FED7AA] shadow-sm'
                          : 'bg-[#FFFFFF] border-[#E2E8F0] hover:border-[#CBD5E1]'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          {isDrink ? (
                            <Coffee className="w-3.5 h-3.5 text-[#172554] shrink-0" />
                          ) : (
                            <Utensils className="w-3.5 h-3.5 text-[#EA580C] shrink-0" />
                          )}
                          <span className="font-bold text-[#0F172A] text-xs truncate">
                            {item.name}
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-[#172554] font-bold mt-0.5">
                          ₹{Number(item.price).toFixed(0)}
                        </div>
                      </div>

                      {/* Stepper (Clamped 0 to 5) */}
                      <div className="flex items-center gap-1.5 bg-[#FFFFFF] border border-[#E2E8F0] rounded-xl p-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleQuantityChange(item.id, -1)}
                          disabled={qty <= 0}
                          className="w-6 h-6 rounded-lg bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#0F172A] disabled:opacity-30 flex items-center justify-center transition-colors"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="w-5 text-center font-mono text-xs font-bold text-[#0F172A]">
                          {qty}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleQuantityChange(item.id, 1)}
                          disabled={qty >= 5}
                          className="w-6 h-6 rounded-lg bg-[#EA580C] hover:bg-[#C2410C] text-white disabled:opacity-30 flex items-center justify-center transition-colors"
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
        <div className="p-4 sm:p-5 border-t border-[#E2E8F0] bg-[#FFFFFF] space-y-3 shrink-0">
          {/* Live Calculated Breakdown */}
          <div className="flex items-center justify-between text-xs font-mono px-1 text-[#64748B]">
            <div>
              Station: <strong className="text-[#0F172A]">₹{baseStationPrice}</strong>
              {snacksTotalCost > 0 && (
                <>
                  {' '}| Snacks: <strong className="text-[#EA580C]">₹{snacksTotalCost}</strong>
                </>
              )}
            </div>
            <div className="text-sm font-black text-[#172554]">
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
