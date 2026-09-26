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
    document.documentElement.classList.remove('dark');

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
    <div className="min-h-screen bg-[#FFF7ED] text-[#0F172A] flex flex-col selection:bg-[#EA580C] selection:text-white relative transition-colors duration-200">
      {/* Background Interactive Gaming & Cafe Canvas */}
      <GamingCafeCanvas isLight={true} />

      {/* Responsive Top PlayStation & Cafe Navigation Bar */}
      <header className="sticky top-0 z-40 bg-[#172554] border-b border-[#1E3A8A]/40 px-3 sm:px-6 lg:px-8 py-2.5 sm:py-3 pt-safe transition-colors shadow-sm">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3 sm:gap-4 relative z-10">
          {/* Brand Logo */}
          <div className="flex items-center space-x-2.5 sm:space-x-3 shrink-0">
            <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-[#EA580C] flex items-center justify-center text-white font-black shadow-md shrink-0">
              <Gamepad2 className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-black text-sm sm:text-base tracking-wider text-[#FFFFFF] font-display uppercase">
                  VANYA GAMING LOUNGE
                </span>
              </div>
              {isAdminPortal && (
                <p className="text-[10px] sm:text-xs text-blue-200 font-sans">
                  Staff Operations Console
                </p>
              )}
            </div>
          </div>

          {/* Admin Navigation Switcher (Only for Admin) */}
          {isAdminPortal && (
            <nav className="hidden md:flex items-center bg-[#0f1a3a]/60 p-1 rounded-xl border border-blue-900/40 shadow-inner space-x-1">
              {/* STATIONS */}
              <button
                onClick={() => setActiveTab('matrix')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold font-display uppercase tracking-wider transition-all cursor-pointer ${
                  activeTab === 'matrix'
                    ? 'bg-[#EA580C] text-[#FFFFFF] shadow-sm'
                    : 'bg-transparent text-[#94A3B8] hover:text-[#FFFFFF]'
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
                    ? 'bg-[#EA580C] text-[#FFFFFF] shadow-sm'
                    : 'bg-transparent text-[#94A3B8] hover:text-[#FFFFFF]'
                }`}
              >
                <BellRing className={`w-4 h-4 ${pendingOrdersCount > 0 ? 'animate-bounce text-amber-300' : ''}`} />
                <span>Orders</span>
                {pendingOrdersCount > 0 ? (
                  <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-[#EA580C] text-white font-bold shadow-xs">
                    {pendingOrdersCount}
                  </span>
                ) : (
                  <span className="ml-1 text-[10px] text-blue-200/60 font-bold">
                    0
                  </span>
                )}
              </button>

              {/* KITCHEN MENU */}
              <button
                onClick={() => setActiveTab('kitchen')}
                className={`relative flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold font-display uppercase tracking-wider transition-all cursor-pointer ${
                  activeTab === 'kitchen'
                    ? 'bg-[#EA580C] text-[#FFFFFF] shadow-sm'
                    : 'bg-transparent text-[#94A3B8] hover:text-[#FFFFFF]'
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
                    ? 'bg-[#EA580C] text-[#FFFFFF] shadow-sm'
                    : 'bg-transparent text-[#94A3B8] hover:text-[#FFFFFF]'
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
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-all border border-white/20 text-xs font-semibold shadow-sm cursor-pointer"
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
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-transparent hover:bg-[#1E3A8A] border border-[#E2E8F0]/30 text-white transition-all text-xs font-bold shadow-sm cursor-pointer"
                title="Staff Operations Console Login"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-white" />
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
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#172554] border-t border-[#1E3A8A]/50 px-2 py-2 pb-safe shadow-[0_-4px_16px_rgba(0,0,0,0.1)] flex items-center justify-around">
          <button
            onClick={() => setActiveTab('matrix')}
            className={`flex flex-col items-center gap-1 py-1 px-2.5 rounded-xl transition-all cursor-pointer ${
              activeTab === 'matrix'
                ? 'text-white bg-[#EA580C]'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <Monitor className="w-4 h-4" />
            <span className="text-[9px] font-bold font-display uppercase tracking-wider">Stations</span>
          </button>

          <button
            onClick={() => setActiveTab('orders')}
            className={`relative flex flex-col items-center gap-1 py-1 px-2.5 rounded-xl transition-all cursor-pointer ${
              activeTab === 'orders'
                ? 'text-white bg-[#EA580C]'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <BellRing className="w-4 h-4" />
            <span className="text-[9px] font-bold font-display uppercase tracking-wider">Orders</span>
            {pendingOrdersCount > 0 && (
              <span className="absolute top-0 right-1 px-1.5 py-0.2 rounded-full text-[9px] bg-amber-400 text-slate-900 font-bold">
                {pendingOrdersCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('kitchen')}
            className={`flex flex-col items-center gap-1 py-1 px-2.5 rounded-xl transition-all cursor-pointer ${
              activeTab === 'kitchen'
                ? 'text-white bg-[#EA580C]'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <ChefHat className="w-4 h-4" />
            <span className="text-[9px] font-bold font-display uppercase tracking-wider">Kitchen</span>
          </button>

          <button
            onClick={() => setActiveTab('shop')}
            className={`flex flex-col items-center gap-1 py-1 px-2.5 rounded-xl transition-all cursor-pointer ${
              activeTab === 'shop'
                ? 'text-white bg-[#EA580C]'
                : 'text-slate-300 hover:text-white'
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
