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
import { fetchLiveStations } from './api';
import { StationLive } from './types';

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

  const occupiedStations = stations.filter((s) => s.status === 'OCCUPIED');

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
      {/* Top Cyber Navigation Bar */}
      <header className="sticky top-0 z-40 bg-[#090d16]/90 backdrop-blur-md border-b border-slate-800/80 px-4 lg:px-8 py-3.5">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          {/* Brand Logo */}
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-cyan-600 flex items-center justify-center text-black font-black shadow-[0_0_20px_rgba(16,185,129,0.4)]">
              <Cpu className="w-6 h-6 text-black" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-black tracking-wider font-display text-white">
                  APEX CYBER LOUNGE
                </h1>
                <span className="text-[10px] font-mono-code px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-800/60 font-bold">
                  v1.0 ENTERPRISE
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono-code">
                Zero-Drift Financials • PostgreSQL Deterministic Row Locks
              </p>
            </div>
          </div>

          {/* View Mode Switcher */}
          <nav className="flex items-center bg-slate-950/80 p-1 rounded-xl border border-slate-800/90 shadow-inner">
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
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold font-display uppercase tracking-wider transition-all ${
                activeTab === 'kitchen'
                  ? 'bg-amber-500 text-black shadow-[0_0_15px_rgba(245,158,11,0.35)]'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <ChefHat className="w-4 h-4" />
              <span>Kitchen KDS</span>
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
          <div className="flex items-center gap-3">
            {activeTab === 'customer' && stations.length > 0 && (
              <div className="flex items-center gap-1.5 text-xs bg-slate-900 px-2.5 py-1.5 rounded-lg border border-slate-800">
                <span className="text-slate-400 font-mono-code text-[11px]">Desk:</span>
                <select
                  value={currentDesk?.id || ''}
                  onChange={(e) => {
                    const st = stations.find((s) => s.id === e.target.value);
                    if (st) {
                      setSelectedDeskId(st.id);
                      setSelectedSessionId(st.active_session_id || null);
                    }
                  }}
                  className="bg-transparent text-white font-semibold text-xs focus:outline-none cursor-pointer"
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
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono-code border transition-colors ${
                isConnected
                  ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60'
                  : 'bg-rose-950/60 text-rose-300 border-rose-800/60'
              }`}
            >
              {isConnected ? (
                <>
                  <Wifi className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                  <span>WS Connected</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3.5 h-3.5 text-rose-400" />
                  <span>WS Reconnecting...</span>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main View Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 lg:p-8">
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
            <div className="glass-panel p-8 rounded-2xl border border-slate-800 text-center space-y-4 max-w-lg mx-auto mt-12">
              <div className="p-3 bg-amber-500/10 text-amber-400 rounded-full inline-block border border-amber-500/30">
                <Gamepad2 className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-bold text-white font-display">
                {currentDesk ? `${currentDesk.name} is currently ${currentDesk.status}` : 'No Station Selected'}
              </h3>
              <p className="text-xs text-slate-400 font-mono-code">
                To activate the Customer HUD with dynamic countdown and in-desk ordering, check-in a player on this station in the Stations Matrix.
              </p>
              <button
                onClick={() => setActiveTab('matrix')}
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs uppercase tracking-wider rounded-xl transition-all shadow-lg hover:shadow-emerald-500/25"
              >
                Go to Stations Matrix
              </button>
            </div>
          )
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/60 py-4 px-8 text-center text-slate-500 text-xs font-mono-code bg-[#060911]">
        <div className="max-w-7xl mx-auto flex flex-wrap justify-between items-center gap-2">
          <span>Enterprise Gaming Cafe Ops • FastApi + SQLAlchemy Async + PostgreSQL 16</span>
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
