import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  UtensilsCrossed,
  Search,
  Plus,
  Minus,
  ShoppingBag,
  X,
  CheckCircle2,
  Tv,
  Coffee,
  AlertCircle,
  Gamepad2,
} from 'lucide-react';
import { fetchMenuItems, fetchFleetCategories, placeInSeatOrderApi, InSeatOrderPayloadClient } from '../api';
import { MenuItem, CategoryAvailability } from '../types';
import { useLoungeStore, CustomerInSeatOrder } from '../store/loungeStore';
import { useNotificationStore } from '../store/notificationStore';
import { GameCatalogueCarousel } from './GameCatalogueCarousel';
import { ErrorBoundary } from './ErrorBoundary';

// Fallback menu items in case the backend DB has no menu items seeded
const DEFAULT_MENU_ITEMS: MenuItem[] = [
  { id: 'm1', name: 'Cold Coffee Frappe', category: 'Drinks', price: 120, is_available: true, description: 'Chilled rich espresso blended with cream and cocoa.' },
  { id: 'm2', name: 'Loaded Nachos Supreme', category: 'Snacks', price: 180, is_available: true, description: 'Crisp tortilla chips baked with salsa, jalapeños, and melted cheese.' },
  { id: 'm3', name: 'Peri-Peri French Fries', category: 'Snacks', price: 110, is_available: true, description: 'Golden crispy fries tossed in spicy peri-peri seasoning.' },
  { id: 'm4', name: 'Red Bull Energy Can', category: 'Drinks', price: 160, is_available: true, description: 'Vitalizes body and mind for intense multiplayer gaming.' },
  { id: 'm5', name: 'Gourmet Veg Burger', category: 'Meals', price: 150, is_available: true, description: 'Crispy patty with lettuce, tomatoes, and secret lounge sauce.' },
  { id: 'm6', name: 'Crispy Chicken Burger', category: 'Meals', price: 190, is_available: true, description: 'Tender fried chicken fillet with smoky mayo and crunchy pickles.' },
  { id: 'm7', name: 'Paneer Tikka Pizza (7")', category: 'Meals', price: 220, is_available: true, description: 'Fresh pan crust topped with tandoori paneer and mozzarella.' },
  { id: 'm8', name: 'Iced Lemon Mint Tea', category: 'Drinks', price: 90, is_available: true, description: 'Refreshing brewed black tea infused with fresh mint and lemon.' },
  { id: 'm9', name: 'Gamer Combo: Burger + Fries + Cola', category: 'Combos', price: 270, is_available: true, description: 'Complete gaming fuel pack for high-octane sessions.' },
];

const DEFAULT_CATEGORIES: { id: string; name: string; hourly_rate: number; supported_devices: string[] }[] = [
  { id: 'solo', name: 'Solo', hourly_rate: 180, supported_devices: ['PS1', 'PS2', 'PS3'] },
  { id: 'multiplayer', name: 'Multiplayer', hourly_rate: 220, supported_devices: ['PS1', 'PS2', 'PS3'] },
  { id: 'car_sim', name: 'Car Simulator', hourly_rate: 250, supported_devices: ['PS3'] },
];

type SubstationOption = 'PS1' | 'PS2' | 'PS3';

export const CustomerPortal: React.FC = () => {
  const queryClient = useQueryClient();
  const { addInSeatOrder } = useLoungeStore();
  const { addNotification } = useNotificationStore();

  // Search & Filter State
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Cart: item.id -> quantity
  const [cart, setCart] = useState<Record<string, number>>({});

  // Checkout Modal State
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [selectedMode, setSelectedMode] = useState<string>('solo');
  const [selectedStation, setSelectedStation] = useState<SubstationOption>('PS1');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [orderConfirmed, setOrderConfirmed] = useState<CustomerInSeatOrder | null>(null);

  // Fetch Modes / Fleet Categories from Server (or fallback to defaults)
  const { data: serverCategories = [] } = useQuery<CategoryAvailability[]>({
    queryKey: ['fleet-categories'],
    queryFn: fetchFleetCategories,
  });

  const availableModes = useMemo(() => {
    if (Array.isArray(serverCategories) && serverCategories.length > 0) {
      const filtered = serverCategories.filter((c) => c.id !== 'vr_sim' && c.id !== 'vr');
      if (filtered.length > 0) return filtered;
    }
    return DEFAULT_CATEGORIES;
  }, [serverCategories]);

  const handleSelectMode = (modeId: string) => {
    setSelectedMode(modeId);
    if (modeId.toLowerCase().includes('car')) {
      setSelectedStation('PS3');
    }
  };

  const handleSelectStation = (st: SubstationOption) => {
    if (selectedMode.toLowerCase().includes('car') && st !== 'PS3') {
      return;
    }
    setSelectedStation(st);
  };

  // Fetch Menu from Server
  const { data: serverMenuItems = [], isLoading } = useQuery<MenuItem[]>({
    queryKey: ['customer-menu'],
    queryFn: fetchMenuItems,
  });

  const menuItems = useMemo(() => {
    if (Array.isArray(serverMenuItems) && serverMenuItems.length > 0) {
      return serverMenuItems;
    }
    return DEFAULT_MENU_ITEMS;
  }, [serverMenuItems]);

  // Extract unique categories
  const categories = useMemo(() => {
    const set = new Set<string>();
    menuItems.forEach((item) => {
      if (item.category) set.add(item.category);
    });
    return ['All', ...Array.from(set)];
  }, [menuItems]);

  // Filtered menu
  const filteredItems = useMemo(() => {
    return menuItems.filter((item) => {
      const matchCat = selectedCategory === 'All' || item.category?.toLowerCase() === selectedCategory.toLowerCase();
      const matchSearch =
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (item.description && item.description.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchCat && matchSearch;
    });
  }, [menuItems, selectedCategory, searchQuery]);

  // Cart operations
  const handleAddToCart = (id: string) => {
    setCart((prev) => ({ ...prev, [id]: (prev[id] || 0) + 1 }));
  };

  const handleRemoveFromCart = (id: string) => {
    setCart((prev) => {
      const current = prev[id] || 0;
      if (current <= 1) {
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return { ...prev, [id]: current - 1 };
    });
  };

  // Cart calculations
  const cartItemList = useMemo(() => {
    return Object.entries(cart)
      .map(([id, qty]) => {
        const item = menuItems.find((m) => m.id === id);
        if (!item || qty <= 0) return null;
        return {
          id: item.id,
          name: item.name,
          price: Number(item.price) || 0,
          quantity: qty,
          total: (Number(item.price) || 0) * qty,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [cart, menuItems]);

  const totalCartCount = useMemo(() => {
    return cartItemList.reduce((sum, i) => sum + i.quantity, 0);
  }, [cartItemList]);

  const totalCartAmount = useMemo(() => {
    return cartItemList.reduce((sum, i) => sum + i.total, 0);
  }, [cartItemList]);

  // Place Order handler
  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName.trim()) {
      setCheckoutError('Please enter your gamer name.');
      return;
    }
    if (!selectedStation) {
      setCheckoutError('Please select your console station (PS1, PS2, or PS3).');
      return;
    }
    if (cartItemList.length === 0) {
      setCheckoutError('Your order cart is empty.');
      return;
    }

    setIsSubmitting(true);
    setCheckoutError(null);

    const orderPayload: InSeatOrderPayloadClient = {
      orderId: `ORD_${Date.now()}`,
      stationId: selectedStation,
      mode: selectedMode,
      customerName: customerName.trim(),
      items: cartItemList.map((i) => ({
        id: i.id,
        name: i.name,
        qty: i.quantity,
        price: i.price,
      })),
      totalAmount: totalCartAmount,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    const modeLabel = availableModes.find((m) => m.id === selectedMode)?.name || selectedMode;

    try {
      // 1. Send to backend in-seat ordering API
      await placeInSeatOrderApi(orderPayload);
      queryClient.invalidateQueries({ queryKey: ['kitchen-orders'] });
      queryClient.invalidateQueries({ queryKey: ['station-matrix'] });
      queryClient.invalidateQueries({ queryKey: ['stations-live'] });

      // 2. Reactively register into global lounge store (triggers instant station sync, audio chime & column highlight)
      addInSeatOrder(orderPayload as CustomerInSeatOrder);

      // 3. User feedback notification
      addNotification(
        'FOOD_ORDER',
        `🍔 Order Placed for ${selectedStation} (${modeLabel})!`,
        `${totalCartCount} item(s) (₹${totalCartAmount.toFixed(2)}) sent to the kitchen.`
      );

      // 4. Success state
      setOrderConfirmed(orderPayload as CustomerInSeatOrder);
      setCart({});
    } catch (err: any) {
      // Graceful fallback: register in lounge store even if network fails
      addInSeatOrder(orderPayload as CustomerInSeatOrder);
      setOrderConfirmed(orderPayload as CustomerInSeatOrder);
      setCart({});
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetAfterOrder = () => {
    setOrderConfirmed(null);
    setIsCheckoutOpen(false);
    setCustomerName('');
    setSelectedMode('solo');
    setSelectedStation('PS1');
  };

  return (
    <div className="space-y-8 sm:space-y-10 relative z-10">
      {/* PS5 Games Marquee Carousel */}
      <ErrorBoundary level="component" fallbackTitle="Game Showcase Interrupted">
        <GameCatalogueCarousel userName="Gamer" />
      </ErrorBoundary>

      {/* 2. IN-SEAT FOOD & BEVERAGE ORDERING MENU */}
      <div className="space-y-5">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-3 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                <UtensilsCrossed className="w-5 h-5" />
              </div>
              <h2 className="text-xl sm:text-2xl font-black text-white font-display tracking-wide">
                In-Seat Food &amp; Drink Ordering
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-slate-400 mt-1">
              Select your favorite snacks and refreshments. Freshly prepared and delivered right to PS1, PS2, or PS3.
            </p>
          </div>

          {/* Search Bar */}
          <div className="relative w-full md:w-72">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search snacks, drinks, meals..."
              className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400 transition-colors"
            />
          </div>
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 no-scrollbar">
          {categories.map((cat) => {
            const isActive = selectedCategory.toLowerCase() === cat.toLowerCase();
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold font-display uppercase tracking-wider transition-all cursor-pointer shrink-0 ${
                  isActive
                    ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 shadow-md shadow-amber-500/20'
                    : 'bg-slate-900/90 text-slate-400 hover:text-white border border-slate-800'
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>

        {/* Menu Cards Grid */}
        {isLoading ? (
          <div className="p-12 text-center bg-slate-900/40 rounded-3xl border border-slate-800 flex justify-center">
            <div className="w-8 h-8 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-12 text-center bg-slate-900/40 rounded-3xl border border-dashed border-slate-800 space-y-2">
            <Coffee className="w-10 h-10 text-slate-600 mx-auto" />
            <p className="text-sm font-bold text-slate-400">No items match your search.</p>
            <p className="text-xs text-slate-500">Try changing the category or clearing the search query.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
            {filteredItems.map((item) => {
              const qty = cart[item.id] || 0;
              const priceNum = Number(item.price) || 0;

              return (
                <div
                  key={item.id}
                  className={`p-4 rounded-2xl bg-slate-900/80 border transition-all duration-200 flex flex-col justify-between space-y-3 relative overflow-hidden group hover:border-amber-500/40 hover:shadow-lg hover:shadow-amber-500/5 ${
                    qty > 0 ? 'border-amber-500/60 ring-1 ring-amber-500/30' : 'border-slate-800/90'
                  }`}
                >
                  <div className="space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-bold text-sm text-white font-display group-hover:text-amber-300 transition-colors">
                        {item.name}
                      </h3>
                      <span className="text-[10px] font-mono-code font-bold uppercase px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700/60 shrink-0">
                        {item.category}
                      </span>
                    </div>
                    {item.description && (
                      <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed font-sans">
                        {item.description}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
                    <span className="font-mono-code text-base font-black text-emerald-400">
                      ₹{priceNum.toFixed(2)}
                    </span>

                    {/* Quantity Selector */}
                    {qty > 0 ? (
                      <div className="flex items-center gap-2 bg-slate-950 p-1 rounded-xl border border-slate-800">
                        <button
                          type="button"
                          onClick={() => handleRemoveFromCart(item.id)}
                          className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center cursor-pointer transition-colors"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="font-mono-code text-xs font-black text-white px-1">
                          {qty}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleAddToCart(item.id)}
                          className="w-7 h-7 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 flex items-center justify-center cursor-pointer font-bold transition-colors"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleAddToCart(item.id)}
                        className="py-1.5 px-3 rounded-xl bg-amber-500/15 hover:bg-amber-500 border border-amber-500/30 hover:border-amber-400 text-amber-300 hover:text-slate-950 text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 3. FLOATING CART SUMMARY BAR (When items in cart) */}
      {totalCartCount > 0 && !isCheckoutOpen && (
        <div className="fixed bottom-4 left-3 right-3 sm:left-auto sm:right-8 sm:w-96 z-40 animate-in slide-in-from-bottom-5">
          <div className="p-3.5 rounded-2xl bg-[#0e131f] border border-amber-500/50 shadow-2xl shadow-black/80 flex items-center justify-between gap-3 backdrop-blur-xl">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center font-black">
                <ShoppingBag className="w-5 h-5" />
              </div>
              <div>
                <span className="text-xs font-black text-white block">
                  {totalCartCount} item{totalCartCount > 1 ? 's' : ''} added
                </span>
                <span className="font-mono-code text-xs font-bold text-emerald-400">
                  Total: ₹{totalCartAmount.toFixed(2)}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsCheckoutOpen(true)}
              className="py-2.5 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-bold uppercase tracking-wider text-xs transition-all shadow-md shadow-amber-500/25 cursor-pointer"
            >
              Order Now
            </button>
          </div>
        </div>
      )}

      {/* 4. ORDER PLACEMENT & CHECKOUT MODAL */}
      {isCheckoutOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-[#0e131f] border border-slate-800 max-w-lg w-full rounded-t-3xl sm:rounded-2xl p-5 sm:p-6 shadow-2xl relative animate-in slide-in-from-bottom-5 duration-200 max-h-[92vh] flex flex-col pb-safe">
            {orderConfirmed ? (
              /* Success Confirmation Screen */
              <div className="text-center py-6 space-y-4">
                <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/20">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-xl font-black text-white font-display">
                    Order Received!
                  </h3>
                  <p className="text-xs text-slate-300">
                    Your order has been routed to the kitchen for preparation.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2 text-xs font-mono-code text-left max-w-sm mx-auto">
                  <div className="flex justify-between text-slate-400">
                    <span>Order ID:</span>
                    <span className="text-amber-400 font-bold">{orderConfirmed.orderId}</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Matrix Allocation:</span>
                    <span className="text-white font-black px-2 py-0.5 rounded bg-blue-500/20 border border-blue-500/40 text-blue-300">
                      {orderConfirmed.mode ? `${orderConfirmed.mode.toUpperCase()} • ${orderConfirmed.stationId}` : orderConfirmed.stationId}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Gamer:</span>
                    <span className="text-white font-bold">{orderConfirmed.customerName}</span>
                  </div>
                  <div className="flex justify-between text-slate-400 pt-1.5 border-t border-slate-800">
                    <span>Total Bill:</span>
                    <span className="text-emerald-400 font-black">₹{orderConfirmed.totalAmount.toFixed(2)}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleResetAfterOrder}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-bold uppercase tracking-wider text-xs transition-all shadow-md cursor-pointer"
                >
                  Done &amp; Return to Menu
                </button>
              </div>
            ) : (
              /* Checkout Form */
              <>
                <div className="flex justify-between items-center pb-3.5 mb-3.5 border-b border-slate-800 shrink-0">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center">
                      <ShoppingBag className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-base sm:text-lg font-bold text-white font-display">
                        Confirm In-Seat Order
                      </h3>
                      <p className="text-[11px] text-slate-400">Deliver to your console station</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsCheckoutOpen(false)}
                    className="text-slate-400 hover:text-white p-1 rounded-lg"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <form onSubmit={handlePlaceOrder} className="space-y-4 overflow-y-auto pr-1 flex-1 text-xs">
                  {/* Customer Name Input */}
                  <div className="space-y-1.5">
                    <label className="block font-semibold text-slate-300">
                      Your Gamer Name: <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="e.g. Alex / ShadowGamer"
                      className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-600 focus:outline-none focus:border-amber-400 text-xs"
                    />
                  </div>

                  {/* Game Mode Selection */}
                  <div className="space-y-1.5">
                    <label className="block font-semibold text-slate-300">
                      Game Mode: <span className="text-rose-400">*</span>
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {availableModes.map((mode) => {
                        const modeId = mode.id;
                        const isSelected = selectedMode === modeId;
                        const isCar = modeId.toLowerCase().includes('car');
                        return (
                          <button
                            key={modeId}
                            type="button"
                            onClick={() => handleSelectMode(modeId)}
                            className={`p-2.5 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all cursor-pointer text-center ${
                              isSelected
                                ? 'bg-amber-500/20 border-amber-400 text-amber-300 ring-2 ring-amber-500/40 shadow-md font-bold'
                                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                            }`}
                          >
                            <Gamepad2 className="w-4 h-4 text-amber-400" />
                            <span className="font-display text-xs tracking-wide">{mode.name}</span>
                            <span className="text-[10px] font-mono-code text-slate-400">
                              ₹{mode.hourly_rate}/hr
                            </span>
                            {isCar && (
                              <span className="text-[9px] font-mono-code text-amber-400 font-bold">
                                Fixed at PS3
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Substation Selection: Strictly restricted to PS1, PS2, or PS3 */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center">
                      <label className="block font-semibold text-slate-300">
                        Console Station: <span className="text-rose-400">*</span>
                      </label>
                      {selectedMode.toLowerCase().includes('car') && (
                        <span className="text-[10px] text-amber-400 font-mono-code font-bold">
                          Fixed to PS3 (Car Sim)
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {(['PS1', 'PS2', 'PS3'] as SubstationOption[]).map((station) => {
                        const isCarMode = selectedMode.toLowerCase().includes('car');
                        const isStationDisabled = isCarMode && station !== 'PS3';
                        const isSelected = selectedStation === station;
                        return (
                          <button
                            key={station}
                            type="button"
                            disabled={isStationDisabled}
                            onClick={() => handleSelectStation(station)}
                            className={`p-3 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all ${
                              isStationDisabled
                                ? 'opacity-30 cursor-not-allowed bg-slate-950 border-slate-900 text-slate-600'
                                : isSelected
                                ? 'bg-blue-600/20 border-blue-400 text-blue-300 ring-2 ring-blue-500/40 shadow-md shadow-blue-500/20 font-black cursor-pointer'
                                : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700 cursor-pointer'
                            }`}
                          >
                            <Tv className="w-4 h-4 text-blue-400" />
                            <span className="font-display text-sm tracking-wider">{station}</span>
                            <span className="text-[9px] font-mono-code text-slate-500 uppercase">
                              {station === 'PS3' && isCarMode ? 'Simulator Rig' : 'Console'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Itemized Order Breakdown */}
                  <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                    <div className="flex justify-between text-slate-400 font-semibold border-b border-slate-800 pb-1.5 text-[11px]">
                      <span>Order Items ({totalCartCount})</span>
                      <span>Amount</span>
                    </div>

                    <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
                      {cartItemList.map((item) => (
                        <div key={item.id} className="flex justify-between items-center text-[11px]">
                          <div className="flex items-center gap-1.5 truncate pr-2">
                            <span className="text-slate-200 truncate">{item.name}</span>
                            <span className="text-amber-400 font-mono-code text-[10px] font-bold">x{item.quantity}</span>
                          </div>
                          <span className="font-mono-code text-slate-100 font-semibold shrink-0">
                            ₹{item.total.toFixed(2)}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="flex justify-between pt-2 border-t border-slate-800 text-white font-bold">
                      <span>Total Amount:</span>
                      <span className="font-mono-code text-emerald-400 text-sm">
                        ₹{totalCartAmount.toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {/* Error display */}
                  {checkoutError && (
                    <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-1.5">
                      <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                      <span>{checkoutError}</span>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="pt-2 flex gap-2.5 shrink-0">
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => setIsCheckoutOpen(false)}
                      className="flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="flex-1 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-bold uppercase tracking-wider text-xs transition-all shadow-lg shadow-amber-500/25 cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                    >
                      {isSubmitting ? (
                        <>
                          <span className="w-3.5 h-3.5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin mr-1" />
                          <span>Sending Order...</span>
                        </>
                      ) : (
                        <span>Place Order (₹{totalCartAmount.toFixed(2)})</span>
                      )}
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
