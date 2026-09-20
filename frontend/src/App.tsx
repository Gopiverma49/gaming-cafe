import { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import {
  Monitor,
  ChefHat,
  LogOut,
  ShoppingBag,
  X,
  Utensils,
  Sparkles,
} from 'lucide-react';
import { StationGrid } from './components/StationGrid';
import { KitchenKanban } from './components/KitchenKanban';
import { CustomerPortal } from './components/CustomerPortal';
import { AdminShopManager } from './components/AdminShopManager';
import { LoginPage } from './components/LoginPage';
import { GamingCafeCanvas } from './components/GamingCafeCanvas';
import { useAuthStore } from './store/authStore';
import { useNotificationStore } from './store/notificationStore';
import { useCafeWebSocket } from './hooks/useCafeWebSocket';
import { fetchKitchenOrders } from './api';
import { Order } from './types';
import { POLL_INTERVALS } from './constants';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 5000,
    },
  },
});

type ActiveTab = 'matrix' | 'shop' | 'kitchen';

function MainDashboard() {
  const { currentPortal, adminUser, customerUser, logout, setPortal } = useAuthStore();
  const {
    activeToast,
    dismissToast,
  } = useNotificationStore();

  const [activeTab, setActiveTab] = useState<ActiveTab>('matrix');
  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  const isAdminPortal = currentPortal === 'admin';
  const activeUser = isAdminPortal ? adminUser : customerUser;

  // Global websocket channel based on active portal
  useCafeWebSocket({ channel: isAdminPortal ? 'admin' : 'customer' });

  // Kitchen orders query for tab badge counter (only needed on admin portal)
  const { data: kitchenOrders = [] } = useQuery<Order[]>({
    queryKey: ['kitchen-orders'],
    queryFn: fetchKitchenOrders,
    refetchInterval: POLL_INTERVALS.KITCHEN_BADGE,
    enabled: isAdminPortal,
  });

  // If user is not authenticated for this portal, show the portal-specific Login Page
  if (!activeUser) {
    return <LoginPage />;
  }

  const pendingOrdersCount = kitchenOrders.filter((o) => o.status !== 'SERVED').length;

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 flex flex-col selection:bg-blue-600 selection:text-white relative transition-colors duration-300">
      {/* Background Interactive Gaming & Cafe Canvas */}
      <GamingCafeCanvas isLight={false} />

      {/* ========================================================================= */}
      {/* FLOATING LIVE NOTIFICATION TOAST (FOR BOOKINGS & FOOD ORDERS) */}
      {/* ========================================================================= */}
      {isAdminPortal && activeToast && (
        <div className="fixed top-20 right-4 z-50 max-w-sm w-full animate-in slide-in-from-right-5 fade-in duration-300">
          <div className="glass-panel p-4 rounded-2xl border border-amber-500/50 shadow-2xl bg-slate-950/95 flex items-start gap-3">
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-500 shrink-0 mt-0.5">
              {activeToast.type === 'FOOD_ORDER' ? (
                <Utensils className="w-5 h-5 text-amber-500 animate-bounce" />
              ) : activeToast.type === 'BOOKING' ? (
                <Gamepad2 className="w-5 h-5 text-blue-500 animate-pulse" />
              ) : (
                <Sparkles className="w-5 h-5 text-cyan-500" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-white font-display uppercase tracking-wider">
                  {activeToast.title}
                </h4>
                <span className="text-[10px] text-slate-400 font-mono-code">
                  {activeToast.timestamp}
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                {activeToast.message}
              </p>
            </div>

            <button
              onClick={dismissToast}
              className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Responsive Top PlayStation & Cafe Navigation Bar */}
      <header className="sticky top-0 z-40 bg-[#090d16]/95 backdrop-blur-xl border-b border-slate-800/80 px-3 sm:px-6 lg:px-8 py-2.5 sm:py-3 pt-safe transition-colors shadow-md">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3 sm:gap-4 relative z-10">
          {/* Brand Logo */}
          <div className="flex items-center space-x-2.5 sm:space-x-3 shrink-0">
            <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-gradient-to-br from-blue-500 via-indigo-600 to-amber-500 flex items-center justify-center text-white font-black shadow-md shadow-blue-500/25 ring-1 ring-blue-500/20 shrink-0">
              <Gamepad2 className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-1.5 sm:gap-2">
                <h1 className="text-base sm:text-lg lg:text-xl font-black tracking-wide font-display text-white whitespace-nowrap">
                  VANYA GAMING & CAFE
                </h1>
                <span className={`hidden sm:inline-block text-[11px] font-mono-code px-2.5 py-0.5 rounded-full border font-bold ${
                  isAdminPortal
                    ? 'bg-amber-950/80 text-amber-400 border-amber-800/60'
                    : 'bg-blue-950/80 text-blue-400 border-blue-800/60'
                }`}>
                  {isAdminPortal ? 'Staff Operations' : 'PlayStation & Bites'}
                </span>
              </div>
              <p className="hidden sm:block text-[11px] sm:text-xs text-slate-300 font-mono-code">
                {isAdminPortal ? 'Console Fleet, Financials & Shop Management' : 'PS5 Ultra Gaming & Table-Side Cafe Orders'}
              </p>
            </div>
          </div>

          {/* Admin Navigation Switcher (Only for Admin) */}
          {isAdminPortal && (
            <nav className="hidden md:flex items-center bg-slate-950/80 p-1 rounded-xl border border-slate-800/90 shadow-inner">
              <button
                onClick={() => setActiveTab('matrix')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold font-display uppercase tracking-wider transition-all ${
                  activeTab === 'matrix'
                    ? 'bg-emerald-500 text-black shadow-[0_0_15px_rgba(16,185,129,0.35)]'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Monitor className="w-4 h-4" />
                <span>Stations</span>
              </button>

              <button
                onClick={() => setActiveTab('kitchen')}
                className={`relative flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold font-display uppercase tracking-wider transition-all ${
                  activeTab === 'kitchen'
                    ? 'bg-orange-500 text-black shadow-[0_0_15px_rgba(249,115,22,0.35)]'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <ChefHat className="w-4 h-4" />
                <span>Kitchen Menu</span>
                {pendingOrdersCount > 0 && (
                  <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-rose-500 text-white font-mono-code font-bold">
                    {pendingOrdersCount}
                  </span>
                )}
              </button>

              <button
                onClick={() => setActiveTab('shop')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold font-display uppercase tracking-wider transition-all ${
                  activeTab === 'shop'
                    ? 'bg-amber-500 text-black shadow-[0_0_15px_rgba(245,158,11,0.35)]'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <ShoppingBag className="w-4 h-4" />
                <span>Inventory</span>
              </button>
            </nav>
          )}

          {/* Header Actions: Sign Out only */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Sign Out Button */}
            <button
              onClick={logout}
              className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-rose-50 dark:bg-slate-900 dark:hover:bg-rose-950/70 text-slate-600 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-300 transition-all border border-slate-200 dark:border-slate-800 text-xs font-semibold shadow-sm"
              title="Sign Out"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main View Area */}
      <main className="relative z-10 flex-1 max-w-7xl w-full mx-auto p-3 sm:p-4 lg:p-8 pb-28 md:pb-8">
        {isAdminPortal ? (
          /* ADMIN VIEW */
          <>
            {activeTab === 'matrix' && <StationGrid />}

            {activeTab === 'shop' && <AdminShopManager />}

            {activeTab === 'kitchen' && <KitchenKanban />}
          </>
        ) : (
          /* CUSTOMER VIEW */
          <CustomerPortal />
        )}
      </main>

      {/* Mobile Sticky Bottom Tab Bar (Admin Only) */}
      {isAdminPortal && (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#090d16]/95 backdrop-blur-xl border-t border-slate-800/90 px-2 py-2 pb-safe shadow-[0_-10px_25px_rgba(0,0,0,0.5)] flex items-center justify-around">
          <button
            onClick={() => setActiveTab('matrix')}
            className={`flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition-all ${
              activeTab === 'matrix'
                ? 'text-emerald-400 bg-emerald-950/50'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Monitor className="w-5 h-5" />
            <span className="text-[10px] font-bold font-display uppercase tracking-wider">Stations</span>
          </button>

          <button
            onClick={() => setActiveTab('kitchen')}
            className={`relative flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition-all ${
              activeTab === 'kitchen'
                ? 'text-orange-400 bg-orange-950/50'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <ChefHat className="w-5 h-5" />
            <span className="text-[10px] font-bold font-display uppercase tracking-wider">Kitchen</span>
            {pendingOrdersCount > 0 && (
              <span className="absolute top-0 right-1 px-1.5 py-0.2 rounded-full text-[9px] bg-rose-500 text-white font-mono-code font-bold">
                {pendingOrdersCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('shop')}
            className={`flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition-all ${
              activeTab === 'shop'
                ? 'text-amber-400 bg-amber-950/50'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <ShoppingBag className="w-5 h-5" />
            <span className="text-[10px] font-bold font-display uppercase tracking-wider">Inventory</span>
          </button>
        </nav>
      )}
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <MainDashboard />
    </QueryClientProvider>
  );
}
