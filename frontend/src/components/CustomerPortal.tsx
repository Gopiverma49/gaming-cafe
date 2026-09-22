import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Gamepad2 } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { fetchLiveStations, fetchFleetCategories } from '../api';
import { StationLive, PricingTier, CategoryAvailability } from '../types';
import { POLL_INTERVALS } from '../constants';
import { CategoryCard } from './CategoryCard';
import { ActiveReservationsTray } from './ActiveReservationsTray';
import { SessionUpsellDrawer } from './SessionUpsellDrawer';
import { StationFoodOrderModal } from './StationFoodOrderModal';
import { GameCatalogueCarousel } from './GameCatalogueCarousel';
import { ErrorBoundary } from './ErrorBoundary';

export const CustomerPortal: React.FC = () => {
  const { user } = useAuthStore();

  // Booking & Upsell drawer states
  const [selectedCategoryForBooking, setSelectedCategoryForBooking] = useState<CategoryAvailability | null>(null);
  const [selectedTierForBooking, setSelectedTierForBooking] = useState<PricingTier | null>(null);

  // Food order modal state
  const [selectedStationForFood, setSelectedStationForFood] = useState<StationLive | null>(null);

  // Fetch live stations from backend database to identify user's personal active session
  const { data: stations = [] } = useQuery<StationLive[]>({
    queryKey: ['stations-live'],
    queryFn: fetchLiveStations,
    refetchInterval: POLL_INTERVALS.STATIONS,
  });

  // Fetch Experience Categories with real-time aggregate device availability
  const {
    data: categories = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<CategoryAvailability[]>({
    queryKey: ['fleet-categories'],
    queryFn: fetchFleetCategories,
    refetchInterval: POLL_INTERVALS.STATIONS,
  });

  const safeStations = Array.isArray(stations) ? stations : [];
  const safeCategories = Array.isArray(categories) ? categories : [];

  // Filter authenticated user's active session(s) strictly for the currently logged-in user
  const myActiveStations = safeStations.filter((s) => {
    if (!user) return false;
    if (!s.is_occupied && s.status !== 'OCCUPIED') return false;

    const matchesUserId = Boolean(user.id && s.user_id && String(s.user_id) === String(user.id));
    const matchesPhone = Boolean(
      user.phone && s.customer_phone && user.phone.trim() && s.customer_phone.trim() === user.phone.trim()
    );
    const isVerifiedMySession = Boolean(s.is_my_session) && user.role !== 'admin';

    return matchesUserId || matchesPhone || isVerifiedMySession;
  });

  return (
    <div className="space-y-6 sm:space-y-8 relative z-10">
      {/* 1. TOP WELCOME & 21-GAME PS5 MARQUEE CAROUSEL */}
      <ErrorBoundary level="component" fallbackTitle="PS5 Game Showcase Interrupted">
        <GameCatalogueCarousel userName={user?.name || 'Gamer'} />
      </ErrorBoundary>

      {/* 2. Personal Session Isolation: My Active Reservations Tray */}
      {myActiveStations.length > 0 && (
        <ActiveReservationsTray
          myStations={myActiveStations}
          onOrderFood={(st) => setSelectedStationForFood(st)}
        />
      )}

      {/* 3. Gaming Stations Fleet: 4 Experience Categories */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Gamepad2 className="w-5 h-5 text-blue-400" />
            <h3 className="text-lg font-bold text-white font-display">
              Gaming Stations Fleet
            </h3>
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
        ) : safeCategories.length === 0 ? (
          <div className="p-12 text-center bg-slate-900/50 rounded-3xl border border-dashed border-slate-800 space-y-2">
            <Gamepad2 className="w-10 h-10 text-slate-600 mx-auto" />
            <p className="text-sm text-slate-400">No categories registered yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 sm:gap-6">
            {safeCategories.map((category) => (
              <CategoryCard
                key={category.id}
                category={category}
                onSelectCategory={(cat, tier) => {
                  setSelectedCategoryForBooking(cat);
                  const firstTier = tier || (Array.isArray(cat.pricing_tiers) && cat.pricing_tiers.length > 0 ? cat.pricing_tiers[0] : null);
                  setSelectedTierForBooking(firstTier);
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* 4. Interactive Upsell & Hardware Selection Drawer */}
      <SessionUpsellDrawer
        isOpen={!!selectedCategoryForBooking}
        category={selectedCategoryForBooking}
        selectedTier={selectedTierForBooking}
        onClose={() => {
          setSelectedCategoryForBooking(null);
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

