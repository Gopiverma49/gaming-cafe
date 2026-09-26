import { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import {
  Monitor,
  ChefHat,
  LogOut,
  ShoppingBag,
  Gamepad2,
  BellRing,
  ShieldCheck,
} from 'lucide-react';
import { StationGrid } from './components/StationGrid';
import { KitchenKanban } from './components/KitchenKanban';
import { AdminOrdersDispatcher } from './components/AdminOrdersDispatcher';
import { CustomerPortal } from './components/CustomerPortal';
import { AdminShopManager } from './components/AdminShopManager';
import { LoginPage } from './components/LoginPage';
import { GamingCafeCanvas } from './components/GamingCafeCanvas';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useAuthStore } from './store/authStore';
import { useCafeWebSocket } from './hooks/useCafeWebSocket';
import { fetchKitchenOrders } from './api';
import { Order } from './types';
import { POLL_INTERVALS } from './constants';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 5000,
      retry: 1,
    },
  },
});

type ActiveTab = 'matrix' | 'orders' | 'shop' | 'kitchen';

function MainDashboard() {
  const { currentPortal, adminUser, logout } = useAuthStore();
  const [activeTab, setActiveTab] = useState<ActiveTab>('matrix');

  useEffect(() => {
    document.documentElement.classList.add('dark');

    // Prevent unhandled promise rejections from causing blank page halts
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.warn('[Global Unhandled Rejection Caught]:', event.reason);
      event.preventDefault();
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  const isAdminPortal = currentPortal === 'admin';

  // Global websocket channel based on active portal
  useCafeWebSocket({ channel: isAdminPortal ? 'admin' : 'customer' });

  // Kitchen orders query for tab badge counter (only needed on admin portal)
  const { data: kitchenOrders = [] } = useQuery<Order[]>({
    queryKey: ['kitchen-orders'],
    queryFn: fetchKitchenOrders,
    refetchInterval: POLL_INTERVALS.KITCHEN_BADGE,
    enabled: isAdminPortal,
  });

  // Only gate with LoginPage if navigating to Admin portal and not logged in as Admin
  if (isAdminPortal && (!adminUser || adminUser.role !== 'admin')) {
    return (
      <ErrorBoundary level="view" fallbackTitle="Staff Login Screen Interrupted">
        <LoginPage />
      </ErrorBoundary>
    );
  }

  const safeKitchenOrders = Array.isArray(kitchenOrders) ? kitchenOrders : [];
  const pendingOrdersCount = safeKitchenOrders.filter(
    (o) => o?.status === 'QUEUED' || (o?.status as any) === 'pending'
  ).length;

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 flex flex-col selection:bg-blue-600 selection:text-white relative transition-colors duration-300">
      {/* Background Interactive Gaming & Cafe Canvas */}
      <GamingCafeCanvas isLight={false} />

      {/* Responsive Top PlayStation & Cafe Navigation Bar */}
      <header className="sticky top-0 z-40 bg-[#090d16]/95 backdrop-blur-xl border-b border-slate-800/80 px-3 sm:px-6 lg:px-8 py-2.5 sm:py-3 pt-safe transition-colors shadow-md">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3 sm:gap-4 relative z-10">
          {/* Brand Logo */}
          <div className="flex items-center space-x-2.5 sm:space-x-3 shrink-0">
            <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-gradient-to-br from-blue-500 via-indigo-600 to-amber-500 flex items-center justify-center text-white font-black shadow-md shadow-blue-500/25 ring-1 ring-blue-500/20 shrink-0">
              <Gamepad2 className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-black text-sm sm:text-base tracking-wider bg-gradient-to-r from-blue-400 via-cyan-400 to-white bg-clip-text text-transparent font-display uppercase">
                  VANYA GAMING LOUNGE
                </span>
              </div>
              {isAdminPortal && (
                <p className="text-[10px] sm:text-xs text-slate-400 font-mono-code">
                  Staff Operations Console
                </p>
              )}
            </div>
          </div>

          {/* Admin Navigation Switcher (Only for Admin) */}
          {isAdminPortal && (
            <nav className="hidden md:flex items-center bg-slate-950/80 p-1 rounded-xl border border-slate-800/90 shadow-inner space-x-1">
              {/* STATIONS */}
              <button
                onClick={() => setActiveTab('matrix')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold font-display uppercase tracking-wider transition-all cursor-pointer ${
                  activeTab === 'matrix'
                    ? 'bg-emerald-500 text-black shadow-[0_0_15px_rgba(16,185,129,0.35)]'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Monitor className="w-4 h-4" />
                <span>Stations</span>
              </button>

              {/* ORDERS (LIVE DISPATCH & TICKET HANDLING) */}
              <button
                onClick={() => setActiveTab('orders')}
                className={`relative flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold font-display uppercase tracking-wider transition-all cursor-pointer ${
                  activeTab === 'orders'
                    ? 'bg-amber-500 text-black shadow-[0_0_15px_rgba(245,158,11,0.35)]'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <BellRing className={`w-4 h-4 ${pendingOrdersCount > 0 ? 'animate-bounce text-amber-400' : ''}`} />
                <span>Orders</span>
                {pendingOrdersCount > 0 ? (
                  <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-amber-400 text-black font-mono-code font-black shadow-sm border border-amber-300 animate-pulse-border">
                    [ {pendingOrdersCount} ]
                  </span>
                ) : (
                  <span className="ml-1 text-[10px] text-slate-500 font-mono-code font-bold">
                    [ 0 ]
                  </span>
                )}
              </button>

              {/* KITCHEN MENU */}
              <button
                onClick={() => setActiveTab('kitchen')}
                className={`relative flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold font-display uppercase tracking-wider transition-all cursor-pointer ${
                  activeTab === 'kitchen'
                    ? 'bg-orange-500 text-black shadow-[0_0_15px_rgba(249,115,22,0.35)]'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <ChefHat className="w-4 h-4" />
                <span>Kitchen Menu</span>
              </button>

              {/* INVENTORY */}
              <button
                onClick={() => setActiveTab('shop')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold font-display uppercase tracking-wider transition-all cursor-pointer ${
                  activeTab === 'shop'
                    ? 'bg-blue-500 text-black shadow-[0_0_15px_rgba(59,130,246,0.35)]'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <ShoppingBag className="w-4 h-4" />
                <span>Inventory</span>
              </button>
            </nav>
          )}

          {/* Header Actions: Sign Out (Admin) or Staff Login (Customer) */}
          <div className="flex items-center gap-2 sm:gap-3">
            {isAdminPortal ? (
              <button
                onClick={logout}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-rose-950/70 text-slate-400 hover:text-rose-300 transition-all border border-slate-800 text-xs font-semibold shadow-sm cursor-pointer"
                title="Sign Out"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Sign Out</span>
              </button>
            ) : (
              <button
                onClick={() => {
                  window.history.pushState({}, '', '/admin/login');
                  useAuthStore.getState().setPortal('admin');
                }}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-slate-900/90 hover:bg-emerald-500/20 border border-slate-700/80 hover:border-emerald-500/50 text-slate-300 hover:text-emerald-300 transition-all text-xs font-bold font-mono-code shadow-sm cursor-pointer"
                title="Staff Operations Console Login"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Staff Login</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main View Area */}
      <main className="relative z-10 flex-1 max-w-7xl w-full mx-auto p-3 sm:p-4 lg:p-8 pb-28 md:pb-8">
        {isAdminPortal ? (
          /* ADMIN VIEW */
          <>
            {activeTab === 'matrix' && (
              <ErrorBoundary level="view" fallbackTitle="Stations Fleet Encountered an Issue">
                <StationGrid />
              </ErrorBoundary>
            )}

            {activeTab === 'orders' && (
              <ErrorBoundary level="view" fallbackTitle="Orders Dispatch Encountered an Issue">
                <AdminOrdersDispatcher />
              </ErrorBoundary>
            )}

            {activeTab === 'kitchen' && (
              <ErrorBoundary level="view" fallbackTitle="Kitchen Kanban Encountered an Issue">
                <KitchenKanban />
              </ErrorBoundary>
            )}

            {activeTab === 'shop' && (
              <ErrorBoundary level="view" fallbackTitle="Inventory Panel Encountered an Issue">
                <AdminShopManager />
              </ErrorBoundary>
            )}
          </>
        ) : (
          /* CUSTOMER VIEW */
          <ErrorBoundary level="view" fallbackTitle="Customer Lounge Encountered an Issue">
            <CustomerPortal />
          </ErrorBoundary>
        )}
      </main>

      {/* Mobile Sticky Bottom Tab Bar (Admin Only) */}
      {isAdminPortal && (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#090d16]/95 backdrop-blur-xl border-t border-slate-800/90 px-2 py-2 pb-safe shadow-[0_-10px_25px_rgba(0,0,0,0.5)] flex items-center justify-around">
          <button
            onClick={() => setActiveTab('matrix')}
            className={`flex flex-col items-center gap-1 py-1 px-2.5 rounded-xl transition-all cursor-pointer ${
              activeTab === 'matrix'
                ? 'text-emerald-400 bg-emerald-950/50'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Monitor className="w-4 h-4" />
            <span className="text-[9px] font-bold font-display uppercase tracking-wider">Stations</span>
          </button>

          <button
            onClick={() => setActiveTab('orders')}
            className={`relative flex flex-col items-center gap-1 py-1 px-2.5 rounded-xl transition-all cursor-pointer ${
              activeTab === 'orders'
                ? 'text-amber-400 bg-amber-950/50'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <BellRing className="w-4 h-4" />
            <span className="text-[9px] font-bold font-display uppercase tracking-wider">Orders</span>
            {pendingOrdersCount > 0 && (
              <span className="absolute top-0 right-1 px-1.5 py-0.2 rounded-full text-[9px] bg-amber-500 text-black font-mono-code font-black">
                {pendingOrdersCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('kitchen')}
            className={`flex flex-col items-center gap-1 py-1 px-2.5 rounded-xl transition-all cursor-pointer ${
              activeTab === 'kitchen'
                ? 'text-orange-400 bg-orange-950/50'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <ChefHat className="w-4 h-4" />
            <span className="text-[9px] font-bold font-display uppercase tracking-wider">Kitchen</span>
          </button>

          <button
            onClick={() => setActiveTab('shop')}
            className={`flex flex-col items-center gap-1 py-1 px-2.5 rounded-xl transition-all cursor-pointer ${
              activeTab === 'shop'
                ? 'text-blue-400 bg-blue-950/50'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <ShoppingBag className="w-4 h-4" />
            <span className="text-[9px] font-bold font-display uppercase tracking-wider">Inventory</span>
          </button>
        </nav>
      )}
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary level="root" fallbackTitle="Application Failed to Render">
        <MainDashboard />
      </ErrorBoundary>
    </QueryClientProvider>
  );
}
