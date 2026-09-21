import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Gamepad2, CalendarCheck } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useLoungeStore } from '../store/loungeStore';
import { fetchLiveStations } from '../api';
import { StationLive } from '../types';
import { StationCard } from './StationCard';
import { StationBookingModal } from './StationBookingModal';
import { StationFoodOrderModal } from './StationFoodOrderModal';
import { GameCatalogueCarousel } from './GameCatalogueCarousel';
import { ErrorBoundary } from './ErrorBoundary';

export const CustomerPortal: React.FC = () => {
  const { user } = useAuthStore();
  const { bookings, cancelBooking } = useLoungeStore();

  // Dialog states
  const [selectedStationForBooking, setSelectedStationForBooking] = useState<StationLive | null>(null);
  const [selectedStationForFood, setSelectedStationForFood] = useState<StationLive | null>(null);

  // Fetch live stations from backend database
  const { data: stations = [], isLoading, isError, error, refetch } = useQuery<StationLive[]>({
    queryKey: ['stations-live'],
    queryFn: fetchLiveStations,
    refetchInterval: 6000,
  });

  const safeStations = Array.isArray(stations) ? stations : [];
  const safeBookings = Array.isArray(bookings) ? bookings : [];

  const myBookings = safeBookings.filter(
    (b) => b?.customerName === user?.name || (b?.customerPhone && b.customerPhone === user?.phone)
  );

  return (
    <div className="space-y-6 sm:space-y-8 relative z-10">
      {/* 1. TOP WELCOME & 21-GAME PS5 MARQUEE CAROUSEL */}
      <ErrorBoundary level="component" fallbackTitle="PS5 Game Showcase Interrupted">
        <GameCatalogueCarousel userName={user?.name || 'Gamer'} />
      </ErrorBoundary>

      {/* 2. My Active Bookings Drawer */}
      {myBookings.length > 0 && (
        <div className="bg-slate-900/80 backdrop-blur-xl p-5 sm:p-6 rounded-3xl border border-blue-500/30 space-y-3">
          <h4 className="text-sm font-bold text-white flex items-center gap-2">
            <CalendarCheck className="w-4 h-4 text-blue-400" />
            <span>My Active Reservations</span>
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {myBookings.map((b) => (
              <div
                key={b.id}
                className="bg-slate-950/80 p-4 rounded-2xl border border-slate-800 text-xs space-y-1.5"
              >
                <div className="flex justify-between items-center">
                  <span className="font-bold text-blue-400 font-mono-code">{b.id}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-bold">
                    {b.status}
                  </span>
                </div>
                <div className="text-white font-bold text-sm">{b.stationName}</div>
                <div className="text-slate-400 text-[11px] font-mono-code flex justify-between">
                  <span>Duration: {b.durationMinutes / 60} hr(s)</span>
                  <span className="text-emerald-400 font-bold">₹{Number(b.totalCost || 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-end pt-1 border-t border-slate-800">
                  <button
                    onClick={() => cancelBooking(b.id)}
                    className="text-rose-400 hover:text-rose-300 text-[11px] font-semibold transition-colors cursor-pointer"
                  >
                    Cancel Booking
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. Stations Grid (Exact Same Cards & UI) */}
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <Gamepad2 className="w-5 h-5 text-blue-400" />
            <h3 className="text-lg font-bold text-white font-display">
              Gaming Stations Fleet
            </h3>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900/80 border border-slate-800 text-xs text-slate-300">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>{safeStations.filter((s) => s?.status === 'AVAILABLE').length} Available</span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900/80 border border-slate-800 text-xs text-slate-300">
              <span className="w-2 h-2 rounded-full bg-cyan-400" />
              <span>{safeStations.filter((s) => s?.status === 'OCCUPIED').length} In Session</span>
            </div>
          </div>
        </div>

        {isError ? (
          <div className="p-8 text-center bg-rose-950/40 rounded-3xl border border-rose-800/60 space-y-3">
            <p className="text-sm font-bold text-rose-300">
              {(error as Error)?.message || 'Unable to connect to gaming fleet.'}
            </p>
            <button
              onClick={() => refetch()}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold cursor-pointer"
            >
              Retry Connection
            </button>
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center p-16 bg-slate-900/50 rounded-3xl border border-slate-800">
            <div className="w-8 h-8 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
          </div>
        ) : safeStations.length === 0 ? (
          <div className="p-12 text-center bg-slate-900/50 rounded-3xl border border-dashed border-slate-800 space-y-2">
            <Gamepad2 className="w-10 h-10 text-slate-600 mx-auto" />
            <p className="text-sm text-slate-400">No stations registered yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
            {safeStations.map((station) => (
              <StationCard
                key={station.id}
                station={station}
                isAdmin={false}
                onBookStation={(s) => setSelectedStationForBooking(s)}
                onOrderFood={(s) => setSelectedStationForFood(s)}
              />
            ))}
          </div>
        )}
      </div>

      {/* 4. Booking Modal (Exact Same UI and Behavior) */}
      <StationBookingModal
        isOpen={!!selectedStationForBooking}
        station={selectedStationForBooking}
        onClose={() => setSelectedStationForBooking(null)}
        isAdmin={false}
        defaultCustomerName={user?.name || ''}
        defaultCustomerPhone={user?.phone || ''}
      />

      {/* 5. Food Order Modal (Exact Same UI and Behavior) */}
      <StationFoodOrderModal
        isOpen={!!selectedStationForFood}
        station={selectedStationForFood}
        onClose={() => setSelectedStationForFood(null)}
        isAdmin={false}
      />
    </div>
  );
};
