import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Gamepad2, CalendarCheck, Clock, Loader2 } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { fetchLiveStations, fetchCustomerSessions, cancelCustomerSessionApi } from '../api';
import { StationLive, PricingTier, CustomerSessionRecord } from '../types';
import { StationCard } from './StationCard';
import { SessionUpsellDrawer } from './SessionUpsellDrawer';
import { StationFoodOrderModal } from './StationFoodOrderModal';
import { GameCatalogueCarousel } from './GameCatalogueCarousel';
import { ErrorBoundary } from './ErrorBoundary';

export const CustomerPortal: React.FC = () => {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  // Booking & Upsell drawer states
  const [selectedStationForBooking, setSelectedStationForBooking] = useState<StationLive | null>(null);
  const [selectedTierForBooking, setSelectedTierForBooking] = useState<PricingTier | null>(null);

  // Food order modal state
  const [selectedStationForFood, setSelectedStationForFood] = useState<StationLive | null>(null);

  // Fetch live stations from backend database
  const { data: stations = [], isLoading, isError, error, refetch } = useQuery<StationLive[]>({
    queryKey: ['stations-live'],
    queryFn: fetchLiveStations,
    refetchInterval: 6000,
  });

  // Fetch real database customer sessions
  const { data: dbSessions = [] } = useQuery<CustomerSessionRecord[]>({
    queryKey: ['customer-sessions', user?.phone, user?.name, user?.id],
    queryFn: () =>
      fetchCustomerSessions({
        phone: user?.phone,
        name: user?.name,
        userId: user?.id,
      }),
    refetchInterval: 5000,
  });

  const cancelMutation = useMutation({
    mutationFn: cancelCustomerSessionApi,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['stations-live'] });
    },
  });

  const safeStations = Array.isArray(stations) ? stations : [];
  const activeReservations = Array.isArray(dbSessions)
    ? dbSessions.filter((s) => s.status === 'ACTIVE')
    : [];

  const handleSelectTier = (st: StationLive, tier: PricingTier) => {
    setSelectedStationForBooking(st);
    setSelectedTierForBooking(tier);
  };

  return (
    <div className="space-y-6 sm:space-y-8 relative z-10">
      {/* 1. TOP WELCOME & 21-GAME PS5 MARQUEE CAROUSEL */}
      <ErrorBoundary level="component" fallbackTitle="PS5 Game Showcase Interrupted">
        <GameCatalogueCarousel userName={user?.name || 'Gamer'} />
      </ErrorBoundary>

      {/* 2. My Active Bookings Drawer (Real SQLite Sessions) */}
      {activeReservations.length > 0 && (
        <div className="bg-slate-900/80 backdrop-blur-xl p-5 sm:p-6 rounded-3xl border border-blue-500/30 space-y-3">
          <h4 className="text-sm font-bold text-white flex items-center justify-between">
            <span className="flex items-center gap-2">
              <CalendarCheck className="w-4 h-4 text-blue-400" />
              <span>My Active Reservations ({activeReservations.length})</span>
            </span>
            <span className="text-[11px] font-mono-code text-cyan-400 bg-cyan-950/60 px-2.5 py-0.5 rounded-full border border-cyan-800/40">
              Live SQLite Sessions
            </span>
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {activeReservations.map((b) => (
              <div
                key={b.id}
                className="bg-slate-950/80 p-4 rounded-2xl border border-slate-800 text-xs space-y-2 hover:border-slate-700 transition-colors"
              >
                <div className="flex justify-between items-center">
                  <span className="font-bold text-blue-400 font-mono-code truncate max-w-[140px]">
                    {b.stationName}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-bold">
                    {b.status}
                  </span>
                </div>

                <div className="text-slate-400 text-[11px] font-mono-code space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="flex items-center gap-1 text-slate-300">
                      <Clock className="w-3 h-3 text-cyan-400" />
                      <span>Elapsed: {b.elapsedMinutes} mins</span>
                    </span>
                    <span className="text-white font-bold">₹{Number(b.totalCost || 0).toFixed(2)}</span>
                  </div>
                  {b.ordersCharge > 0 && (
                    <div className="text-[10px] text-slate-400 flex justify-between">
                      <span>Cafe Orders Tab:</span>
                      <span className="text-amber-400">₹{Number(b.ordersCharge).toFixed(2)}</span>
                    </div>
                  )}
                </div>

                <div className="flex justify-between items-center pt-2 border-t border-slate-800/80">
                  <span className="text-[10px] text-slate-400">Rate: ₹{b.hourlyRate}/hr</span>
                  <button
                    onClick={() => cancelMutation.mutate(b.id)}
                    disabled={cancelMutation.isPending && cancelMutation.variables === b.id}
                    className="text-rose-400 hover:text-rose-300 text-[11px] font-semibold transition-colors cursor-pointer flex items-center gap-1 disabled:opacity-50"
                  >
                    {cancelMutation.isPending && cancelMutation.variables === b.id ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin" />
                        <span>Cancelling...</span>
                      </>
                    ) : (
                      <span>Cancel Session</span>
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. Stations Grid */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Gamepad2 className="w-5 h-5 text-blue-400" />
          <h3 className="text-lg font-bold text-white font-display">
            Gaming Stations Fleet
          </h3>
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
                onSelectTier={handleSelectTier}
                onBookStation={(s) => {
                  setSelectedStationForBooking(s);
                  const firstTier = Array.isArray(s.pricing_tiers) && s.pricing_tiers.length > 0 ? s.pricing_tiers[0] : null;
                  setSelectedTierForBooking(firstTier);
                }}
                onOrderFood={(s) => setSelectedStationForFood(s)}
              />
            ))}
          </div>
        )}
      </div>

      {/* 4. Interactive Upsell Drawer (Replaces old static booking modal) */}
      <SessionUpsellDrawer
        isOpen={!!selectedStationForBooking}
        station={selectedStationForBooking}
        selectedTier={selectedTierForBooking}
        onClose={() => {
          setSelectedStationForBooking(null);
          setSelectedTierForBooking(null);
        }}
        isAdmin={false}
        defaultCustomerName={user?.name || ''}
        defaultCustomerPhone={user?.phone || ''}
      />

      {/* 5. Food Order Modal */}
      <StationFoodOrderModal
        isOpen={!!selectedStationForFood}
        station={selectedStationForFood}
        onClose={() => setSelectedStationForFood(null)}
        isAdmin={false}
      />
    </div>
  );
};
