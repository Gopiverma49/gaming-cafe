import { useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import {
  Monitor,
  ChefHat,
  Gamepad2,
  Cpu,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { StationGrid } from './components/StationGrid';
import { KitchenKanban } from './components/KitchenKanban';
import { CustomerHUD } from './components/CustomerHUD';
import { useCafeWebSocket } from './hooks/useCafeWebSocket';
import { fetchLiveStations, fetchKitchenOrders } from './api';
import { StationLive, Order } from './types';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000,
      retry: 1,
    },
  },
});

type ActiveTab = 'matrix' | 'kitchen' | 'customer';

function MainDashboard() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('matrix');
  const [selectedDeskId, setSelectedDeskId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

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

  const occupiedStations = stations.filter((s) => s.status === 'OCCUPIED');
  const pendingOrdersCount = kitchenOrders.filter((o) => o.status !== 'SERVED').length;

  const handleSelectStationForDesk = (stationId: string, sessionId?: string) => {
    setSelectedDeskId(stationId);
    setSelectedSessionId(sessionId || null);
    setActiveTab('customer');
  };

  // If entering customer HUD without a selected desk, auto-select first occupied station
  const currentDesk = stations.find((s) => s.id === selectedDeskId) || occupiedStations[0] || stations[0];
  const activeSessionId = selectedSessionId || currentDesk?.active_session_id;

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 flex flex-col selection:bg-emerald-500 selection:text-black">
      {/* Responsive Top Cyber Navigation Bar */}
      <header className="sticky top-0 z-40 bg-[#090d16]/95 backdrop-blur-md border-b border-slate-800/80 px-3 sm:px-4 lg:px-8 py-2.5 sm:py-3.5 pt-safe">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-2 sm:gap-4">
          {/* Brand Logo */}
          <div className="flex items-center space-x-2 sm:space-x-3">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-cyan-600 flex items-center justify-center text-black font-black shadow-[0_0_15px_rgba(16,185,129,0.35)] shrink-0">
              <Cpu className="w-5 h-5 sm:w-6 sm:h-6 text-black" />
            </div>
            <div>
              <div className="flex items-center gap-1.5 sm:gap-2">
                <h1 className="text-base sm:text-lg font-black tracking-wider font-display text-white truncate">
                  APEX CYBER LOUNGE
                </h1>
                <span className="hidden sm:inline-block text-[10px] font-mono-code px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-800/60 font-bold">
                  v1.0
                </span>
              </div>
              <p className="hidden sm:block text-[11px] text-slate-400 font-mono-code">
                Zero-Drift Financials • Deterministic Row Locks
              </p>
            </div>
          </div>

          {/* Desktop Navigation Switcher (Hidden on Mobile) */}
          <nav className="hidden md:flex items-center bg-slate-950/80 p-1 rounded-xl border border-slate-800/90 shadow-inner">
            <button
              onClick={() => setActiveTab('matrix')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold font-display uppercase tracking-wider transition-all ${
                activeTab === 'matrix'
                  ? 'bg-emerald-500 text-black shadow-[0_0_15px_rgba(16,185,129,0.35)]'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Monitor className="w-4 h-4" />
              <span>Stations Matrix</span>
            </button>

            <button
              onClick={() => setActiveTab('kitchen')}
              className={`relative flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold font-display uppercase tracking-wider transition-all ${
                activeTab === 'kitchen'
                  ? 'bg-amber-500 text-black shadow-[0_0_15px_rgba(245,158,11,0.35)]'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <ChefHat className="w-4 h-4" />
              <span>Kitchen KDS</span>
              {pendingOrdersCount > 0 && (
                <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-rose-500 text-white font-mono-code">
                  {pendingOrdersCount}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('customer')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold font-display uppercase tracking-wider transition-all ${
                activeTab === 'customer'
                  ? 'bg-cyan-500 text-black shadow-[0_0_15px_rgba(6,182,212,0.35)]'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Gamepad2 className="w-4 h-4" />
              <span>Customer HUD</span>
            </button>
          </nav>

          {/* Real-time Status Badge & Desk Selector */}
          <div className="flex items-center gap-2 sm:gap-3">
            {activeTab === 'customer' && stations.length > 0 && (
              <div className="flex items-center gap-1 text-xs bg-slate-900 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-lg border border-slate-800 max-w-[130px] sm:max-w-none">
                <span className="text-slate-400 font-mono-code text-[10px] sm:text-[11px] hidden sm:inline">Desk:</span>
                <select
                  value={currentDesk?.id || ''}
                  onChange={(e) => {
                    const st = stations.find((s) => s.id === e.target.value);
                    if (st) {
                      setSelectedDeskId(st.id);
                      setSelectedSessionId(st.active_session_id || null);
                    }
                  }}
                  className="bg-transparent text-white font-semibold text-xs focus:outline-none cursor-pointer truncate max-w-full"
                >
                  {stations.map((st) => (
                    <option key={st.id} value={st.id} className="bg-slate-900 text-white">
                      {st.name} ({st.status})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div
              className={`flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg text-[11px] sm:text-xs font-mono-code border transition-colors ${
                isConnected
                  ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60'
                  : 'bg-rose-950/60 text-rose-300 border-rose-800/60'
              }`}
            >
              {isConnected ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span className="hidden sm:inline">WS Live</span>
                  <Wifi className="w-3.5 h-3.5 sm:hidden text-emerald-400" />
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-rose-400"></span>
                  <span className="hidden sm:inline">WS Reconnecting</span>
                  <WifiOff className="w-3.5 h-3.5 sm:hidden text-rose-400" />
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main View Area (with bottom padding for mobile navigation bar) */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-4 lg:p-8 pb-28 md:pb-8">
        {activeTab === 'matrix' && (
          <StationGrid onSelectStationForDeskView={handleSelectStationForDesk} />
        )}

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
                To activate the Customer HUD with dynamic countdown and in-desk ordering, check-in a player on this station in the Stations Matrix.
              </p>
              <button
                onClick={() => setActiveTab('matrix')}
                className="w-full sm:w-auto px-5 py-3 bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs uppercase tracking-wider rounded-xl transition-all shadow-lg hover:shadow-emerald-500/25"
              >
                Go to Stations Matrix
              </button>
            </div>
          )
        )}
      </main>

      {/* Mobile Sticky Bottom Tab Bar (Appears on Mobile Screens) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#090d16]/95 backdrop-blur-xl border-t border-slate-800/90 px-3 py-2 pb-safe shadow-[0_-10px_25px_rgba(0,0,0,0.5)] flex items-center justify-around">
        <button
          onClick={() => setActiveTab('matrix')}
          className={`flex flex-col items-center gap-1 py-1 px-4 rounded-xl transition-all ${
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
          className={`relative flex flex-col items-center gap-1 py-1 px-4 rounded-xl transition-all ${
            activeTab === 'kitchen'
              ? 'text-amber-400 bg-amber-950/50'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <ChefHat className="w-5 h-5" />
          <span className="text-[10px] font-bold font-display uppercase tracking-wider">Kitchen</span>
          {pendingOrdersCount > 0 && (
            <span className="absolute top-0 right-2 px-1.5 py-0.2 rounded-full text-[9px] bg-rose-500 text-white font-mono-code font-bold">
              {pendingOrdersCount}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('customer')}
          className={`flex flex-col items-center gap-1 py-1 px-4 rounded-xl transition-all ${
            activeTab === 'customer'
              ? 'text-cyan-400 bg-cyan-950/50'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Gamepad2 className="w-5 h-5" />
          <span className="text-[10px] font-bold font-display uppercase tracking-wider">HUD</span>
        </button>
      </nav>

      {/* Desktop Footer */}
      <footer className="hidden md:block border-t border-slate-800/60 py-4 px-8 text-center text-slate-500 text-xs font-mono-code bg-[#060911]">
        <div className="max-w-7xl mx-auto flex flex-wrap justify-between items-center gap-2">
          <span>Enterprise Gaming Cafe Ops • FastAPI + SQLAlchemy Async + PostgreSQL 16</span>
          <span className="text-slate-400">Post-Commit Event Broadcasts • Zero Phantom Events</span>
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
