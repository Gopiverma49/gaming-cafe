import { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import {
  Monitor,
  ChefHat,
  Gamepad2,
  LogOut,
  ShieldCheck,
  ShoppingBag,
  Bell,
  X,
  Utensils,
  Sparkles,
} from 'lucide-react';
import { StationGrid } from './components/StationGrid';
import { KitchenKanban } from './components/KitchenKanban';
import { CustomerHUD } from './components/CustomerHUD';
import { CustomerPortal } from './components/CustomerPortal';
import { AdminShopManager } from './components/AdminShopManager';
import { LoginPage } from './components/LoginPage';
import { GamingCafeCanvas } from './components/GamingCafeCanvas';
import { useAuthStore } from './store/authStore';
import { useNotificationStore } from './store/notificationStore';
import { useCafeWebSocket } from './hooks/useCafeWebSocket';
import { fetchLiveStations, fetchKitchenOrders } from './api';
import { StationLive, Order } from './types';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 5000,
    },
  },
});

type ActiveTab = 'matrix' | 'shop' | 'kitchen' | 'customer';

function MainDashboard() {
  const { user, logout } = useAuthStore();
  const {
    notifications,
    activeToast,
    dismissToast,
    markAllAsRead,
    clearNotifications,
  } = useNotificationStore();

  const [activeTab, setActiveTab] = useState<ActiveTab>('matrix');
  const [selectedDeskId, setSelectedDeskId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [showNotificationTray, setShowNotificationTray] = useState(false);
  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  // Global admin websocket channel
  const { isConnected } = useCafeWebSocket({ channel: 'admin' });

  // Stations query to populate customer desk selector
  const { data: stations = [] } = useQuery<StationLive[]>({
    queryKey: ['stations-live'],
    queryFn: fetchLiveStations,
  });

  // Kitchen orders query for tab badge counter
  const { data: kitchenOrders = [] } = useQuery<Order[]>({
    queryKey: ['kitchen-orders'],
    queryFn: fetchKitchenOrders,
    refetchInterval: 12000,
  });

  // If user is not authenticated, show the first-page Login Page
  if (!user) {
    return <LoginPage />;
  }

  const occupiedStations = stations.filter((s) => s.status === 'OCCUPIED');
  const pendingOrdersCount = kitchenOrders.filter((o) => o.status !== 'SERVED').length;
  const unreadNotifCount = notifications.filter((n) => !n.read).length;

  const handleSelectStationForDesk = (stationId: string, sessionId?: string) => {
    setSelectedDeskId(stationId);
    setSelectedSessionId(sessionId || null);
    setActiveTab('customer');
  };

  const currentDesk = stations.find((s) => s.id === selectedDeskId) || occupiedStations[0] || stations[0];
  const activeSessionId = selectedSessionId || currentDesk?.active_session_id;

  const isAdmin = user.role === 'admin';

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 flex flex-col selection:bg-blue-600 selection:text-white relative transition-colors duration-300">
      {/* Background Interactive Gaming & Cafe Canvas */}
      <GamingCafeCanvas isLight={false} />

      {/* ========================================================================= */}
      {/* FLOATING LIVE NOTIFICATION TOAST (FOR BOOKINGS & FOOD ORDERS) */}
      {/* ========================================================================= */}
      {isAdmin && activeToast && (
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
                  isAdmin
                    ? 'bg-amber-950/80 text-amber-400 border-amber-800/60'
                    : 'bg-blue-950/80 text-blue-400 border-blue-800/60'
                }`}>
                  {isAdmin ? 'Staff Operations' : 'PlayStation & Bites'}
                </span>
              </div>
              <p className="hidden sm:block text-[11px] sm:text-xs text-slate-300 font-mono-code">
                {isAdmin ? 'Console Fleet, Financials & Shop Management' : 'PS5 Ultra Gaming & Table-Side Cafe Orders'}
              </p>
            </div>
          </div>

          {/* Admin Navigation Switcher (Only for Admin) */}
          {isAdmin && (
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
                onClick={() => setActiveTab('shop')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold font-display uppercase tracking-wider transition-all ${
                  activeTab === 'shop'
                    ? 'bg-amber-500 text-black shadow-[0_0_15px_rgba(245,158,11,0.35)]'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <ShoppingBag className="w-4 h-4" />
                <span>Shop & Catalog</span>
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
                <span>Kitchen KDS</span>
                {pendingOrdersCount > 0 && (
                  <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-rose-500 text-white font-mono-code font-bold">
                    {pendingOrdersCount}
                  </span>
                )}
              </button>

              <button
                onClick={() => setActiveTab('customer')}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold font-display uppercase tracking-wider transition-all ${
                  activeTab === 'customer'
                    ? 'bg-cyan-500 text-black shadow-[0_0_15px_rgba(6,182,212,0.35)]'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Gamepad2 className="w-4 h-4" />
                <span>Customer HUD</span>
              </button>
            </nav>
          )}

          {/* User Profile, Notifications & Actions */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Live Notification Bell for Admin */}
            {isAdmin && (
              <div className="relative">
                <button
                  onClick={() => {
                    setShowNotificationTray(!showNotificationTray);
                    if (!showNotificationTray) markAllAsRead();
                  }}
                  className={`p-2 rounded-xl border transition-all relative ${
                    unreadNotifCount > 0
                      ? 'bg-amber-950/80 border-amber-500/80 text-amber-400'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                  }`}
                  title="Notifications"
                >
                  <Bell className="w-4 h-4" />
                  {unreadNotifCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-rose-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center font-mono-code animate-pulse">
                      {unreadNotifCount}
                    </span>
                  )}
                </button>

                {/* Dropdown Notification Tray */}
                {showNotificationTray && (
                  <div className="absolute right-0 top-12 w-80 sm:w-96 glass-panel p-4 rounded-2xl border border-slate-800 shadow-2xl bg-slate-950/95 z-50 space-y-3 animate-in fade-in zoom-in-95">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                      <div className="flex items-center gap-2">
                        <Bell className="w-4 h-4 text-amber-400" />
                        <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                          Live Notifications
                        </h4>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={clearNotifications}
                          className="text-[10px] text-slate-400 hover:text-slate-200"
                        >
                          Clear All
                        </button>
                        <button
                          onClick={() => setShowNotificationTray(false)}
                          className="text-slate-500 hover:text-white"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                      {notifications.length === 0 ? (
                        <div className="text-center py-6 text-xs text-slate-500">
                          No notifications yet.
                        </div>
                      ) : (
                        notifications.map((n) => (
                          <div
                            key={n.id}
                            className={`p-2.5 rounded-xl border text-xs space-y-1 transition-all ${
                              n.type === 'FOOD_ORDER'
                                ? 'bg-amber-950/40 border-amber-800/40 text-amber-200'
                                : n.type === 'BOOKING'
                                ? 'bg-emerald-950/40 border-emerald-800/40 text-emerald-200'
                                : 'bg-slate-900/60 border-slate-800 text-slate-300'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-white flex items-center gap-1">
                                {n.type === 'FOOD_ORDER' && <Utensils className="w-3 h-3 text-amber-400" />}
                                {n.type === 'BOOKING' && <Gamepad2 className="w-3 h-3 text-emerald-400" />}
                                {n.title}
                              </span>
                              <span className="text-[10px] text-slate-400 font-mono-code">
                                {n.timestamp}
                              </span>
                            </div>
                            <p className="text-[11px] leading-relaxed text-slate-300">
                              {n.message}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* User Badge (Admin Only) */}
            {isAdmin && (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-700/60 text-amber-800 dark:text-amber-300">
                <ShieldCheck className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <span className="truncate max-w-[100px] sm:max-w-[130px]">
                  {user.name}
                </span>
              </div>
            )}

            {/* WebSocket Indicator (Admin Only) */}
            {isAdmin && (
              <div
                className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-mono-code border transition-colors ${
                  isConnected
                    ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60'
                    : 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800/60'
                }`}
              >
                {isConnected ? (
                  <>
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    <span>Live</span>
                  </>
                ) : (
                  <>
                    <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                    <span>Syncing</span>
                  </>
                )}
              </div>
            )}



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
      <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-4 lg:p-8 pb-28 md:pb-8">
        {isAdmin ? (
          /* ADMIN VIEW */
          <>
            {activeTab === 'matrix' && (
              <StationGrid onSelectStationForDeskView={handleSelectStationForDesk} />
            )}

            {activeTab === 'shop' && <AdminShopManager />}

            {activeTab === 'kitchen' && <KitchenKanban />}

            {activeTab === 'customer' && (
              currentDesk?.status === 'OCCUPIED' && activeSessionId ? (
                <CustomerHUD
                  initialDeskId={currentDesk.id}
                  initialSessionId={activeSessionId}
                  onBackToMatrix={() => setActiveTab('matrix')}
                />
              ) : (
                <div className="glass-panel p-6 sm:p-8 rounded-2xl border border-slate-800 text-center space-y-4 max-w-lg mx-auto mt-6 sm:mt-12">
                  <div className="p-3 bg-amber-500/10 text-amber-400 rounded-full inline-block border border-amber-500/30">
                    <Gamepad2 className="w-8 h-8" />
                  </div>
                  <h3 className="text-base sm:text-lg font-bold text-white font-display">
                    {currentDesk ? `${currentDesk.name} is currently ${currentDesk.status}` : 'No Station Selected'}
                  </h3>
                  <p className="text-xs text-slate-400 font-mono-code leading-relaxed">
                    To preview the Customer HUD with dynamic countdown and in-desk ordering, check-in a player on this station in the Stations view.
                  </p>
                  <button
                    onClick={() => setActiveTab('matrix')}
                    className="w-full sm:w-auto px-5 py-3 bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs uppercase tracking-wider rounded-xl transition-all shadow-lg hover:shadow-emerald-500/25"
                  >
                    Go to Stations
                  </button>
                </div>
              )
            )}
          </>
        ) : (
          /* CUSTOMER VIEW */
          <CustomerPortal />
        )}
      </main>

      {/* Mobile Sticky Bottom Tab Bar (Admin Only) */}
      {isAdmin && (
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
            onClick={() => setActiveTab('shop')}
            className={`flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition-all ${
              activeTab === 'shop'
                ? 'text-amber-400 bg-amber-950/50'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <ShoppingBag className="w-5 h-5" />
            <span className="text-[10px] font-bold font-display uppercase tracking-wider">Shop</span>
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
            onClick={() => setActiveTab('customer')}
            className={`flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition-all ${
              activeTab === 'customer'
                ? 'text-cyan-400 bg-cyan-950/50'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Gamepad2 className="w-5 h-5" />
            <span className="text-[10px] font-bold font-display uppercase tracking-wider">HUD</span>
          </button>
        </nav>
      )}

      {/* Desktop Footer */}
      <footer className="hidden md:block border-t border-slate-800/60 py-4 px-8 text-center text-slate-500 text-xs font-mono-code bg-[#060911] backdrop-blur-md relative z-10">
        <div className="max-w-7xl mx-auto flex flex-wrap justify-between items-center gap-2">
          <span>VANYA PLAYSTATION LOUNGE & CAFE • {isAdmin ? 'Staff Operations Console' : 'Customer Player Portal'}</span>
          <span className="text-slate-400">Fresh Gourmet Bites • Ultra 4K Console Gaming</span>
        </div>
      </footer>
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
