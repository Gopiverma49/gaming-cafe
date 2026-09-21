import React, { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Gamepad2,
  XCircle,
  Clock,
  Sparkles,
  User,
  Phone,
  AlertCircle,
} from 'lucide-react';
import { StationLive } from '../types';
import { checkInStation } from '../api';
import { useAuthStore } from '../store/authStore';
import { useLoungeStore } from '../store/loungeStore';
import { useNotificationStore } from '../store/notificationStore';

interface StationBookingModalProps {
  isOpen: boolean;
  station: StationLive | null;
  onClose: () => void;
  isAdmin?: boolean;
  defaultCustomerName?: string;
  defaultCustomerPhone?: string;
  onSuccess?: () => void;
}

export const StationBookingModal: React.FC<StationBookingModalProps> = ({
  isOpen,
  station,
  onClose,
  isAdmin = false,
  defaultCustomerName = '',
  defaultCustomerPhone = '',
  onSuccess,
}) => {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const { addBooking, recordCustomerVisit } = useLoungeStore();
  const { addNotification } = useNotificationStore();

  const [customerName, setCustomerName] = useState(defaultCustomerName || user?.name || '');
  const [customerPhone, setCustomerPhone] = useState(defaultCustomerPhone || user?.phone || '');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [isCustomDuration, setIsCustomDuration] = useState(false);
  const [customInputMinutes, setCustomInputMinutes] = useState('90');
  const [error, setError] = useState<string | null>(null);

  // Derive active tiers with strictly parsed numbers
  const activeTiers = Array.isArray(station?.pricing_tiers) && station.pricing_tiers.length > 0
    ? station.pricing_tiers.map((t) => ({
        duration_min: Number(t?.duration_min || 60),
        price: Number(t?.price || 180),
        label: t?.label || `${t?.duration_min || 60} mins`,
      }))
    : [
        { duration_min: 30, price: Math.round(Number(station?.hourly_rate || 180) * 0.5), label: '30 mins' },
        { duration_min: 60, price: Number(station?.hourly_rate || 180), label: '1 hr' },
        { duration_min: 120, price: Number(station?.hourly_rate || 180) * 2, label: '2 hrs' },
      ];

  const defaultHourlyRate = Number(station?.default_hourly_rate || station?.hourly_rate || 180);

  // Real-time price calculation:
  // 1. Matches configured tier -> instant tier price (guaranteed number)
  // 2. Custom minutes / outside tiers -> (default_hourly_rate / 60) * minutes
  const matchedTier = activeTiers.find((t) => t.duration_min === durationMinutes);
  const totalCost: number = matchedTier
    ? Number(matchedTier.price)
    : Math.round(((defaultHourlyRate / 60) * durationMinutes) * 100) / 100;

  useEffect(() => {
    if (isOpen && station) {
      setCustomerName(defaultCustomerName || user?.name || (isAdmin ? 'Walk-in Gamer' : 'Player'));
      setCustomerPhone(defaultCustomerPhone || user?.phone || '');
      setIsCustomDuration(false);

      // Default to 60m tier if available, otherwise first tier
      const initialTier = activeTiers.find((t) => t.duration_min === 60) || activeTiers[0];
      setDurationMinutes(initialTier ? initialTier.duration_min : 60);
      setError(null);
    }
  }, [isOpen, station, defaultCustomerName, defaultCustomerPhone, user, isAdmin]);

  const bookingMutation = useMutation({
    mutationFn: async () => {
      if (!station) return;
      const finalCustomerName = customerName.trim() || user?.name || (isAdmin ? 'Walk-in Gamer' : 'Player');
      const finalPhone = customerPhone.trim() || user?.phone || undefined;
      return await checkInStation(
        station.id,
        durationMinutes,
        finalCustomerName,
        finalPhone,
        user?.id
      );
    },
    onSuccess: () => {
      if (!station) return;
      const finalCustomerName = customerName.trim() || (isAdmin ? 'Walk-in Gamer' : 'Player');

      addBooking({
        stationId: station.id,
        stationName: station.name,
        customerName: finalCustomerName,
        customerPhone: customerPhone.trim() || undefined,
        bookingType: 'NOW',
        scheduledTime: 'Immediate Access',
        durationMinutes,
        hourlyRate: defaultHourlyRate,
        totalCost: Number(totalCost),
        status: 'CONFIRMED',
      });

      recordCustomerVisit(
        finalCustomerName,
        customerPhone.trim() || undefined,
        Number(totalCost)
      );

      addNotification(
        'BOOKING',
        '🎮 Station Booked & Active!',
        `${finalCustomerName} booked ${station.name} for ${durationMinutes} mins (₹${Number(totalCost).toFixed(0)}).`
      );

      queryClient.invalidateQueries({ queryKey: ['stations-live'] });
      onSuccess?.();
      onClose();
    },
    onError: (err: any) => {
      setError(err.message || 'Failed to complete booking. Please try again.');
    },
  });

  if (!isOpen || !station) return null;

  const handleConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName.trim()) {
      setError('Please enter a customer or player name.');
      return;
    }
    if (durationMinutes <= 0) {
      setError('Please select or enter a valid duration.');
      return;
    }
    setError(null);
    bookingMutation.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-slate-900 border border-emerald-500/40 max-w-md w-full rounded-t-3xl sm:rounded-3xl p-5 sm:p-6 shadow-2xl relative animate-in slide-in-from-bottom-5 sm:zoom-in-95 max-h-[90vh] overflow-y-auto pb-safe">
        {/* Header */}
        <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-800">
          <div className="flex items-center space-x-2.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Gamepad2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-white font-display">
                Book Console Station
              </h3>
              <p className="text-xs text-slate-400">
                {isAdmin ? 'Admin walk-in booking' : 'Direct mobile seat reservation'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <XCircle className="w-6 h-6" />
          </button>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mb-4 p-3 rounded-xl bg-rose-950/80 border border-rose-600/70 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleConfirm} className="space-y-4 text-sm">
          {/* Station Details Card */}
          <div className="bg-slate-950/80 p-3.5 rounded-2xl border border-slate-800 text-xs space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Selected Station:</span>
              <span className="text-white font-bold text-sm">{station.name}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Hardware & Tier:</span>
              <span className="text-violet-300 font-semibold uppercase">{station.tier}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Default Hourly Rate:</span>
              <span className="text-emerald-400 font-mono-code font-bold text-sm">
                ₹{defaultHourlyRate.toFixed(0)} / hr
              </span>
            </div>
            {Array.isArray(station?.pricing_tiers) && station.pricing_tiers.length > 0 && (
              <div className="pt-1 border-t border-slate-800/80 flex items-center justify-between">
                <span className="text-[11px] text-slate-400">Configured Slabs:</span>
                <div className="flex flex-wrap gap-1 justify-end">
                  {station.pricing_tiers.map((pt, i) => (
                    <span
                      key={i}
                      className="px-1.5 py-0.5 rounded bg-emerald-950/70 text-emerald-300 border border-emerald-600/30 text-[10px] font-mono-code font-bold"
                    >
                      {pt?.label || `${pt?.duration_min ?? 0}m`}: ₹{Number(pt?.price ?? 0).toFixed(0)}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Customer Name */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-slate-400" />
              <span>Customer / Gamer Name:</span>
            </label>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="e.g. Rahul Sharma"
              className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500 transition-colors"
              required
            />
          </div>

          {/* Customer Phone (Optional) */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5 text-slate-400" />
              <span>Mobile Phone (Optional):</span>
            </label>
            <input
              type="tel"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="10-digit number"
              className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500 transition-colors"
            />
          </div>

          {/* Duration Selector with Dynamic Pricing Tiers */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span>Select Play Duration:</span>
              </label>
              <button
                type="button"
                onClick={() => {
                  const nextState = !isCustomDuration;
                  setIsCustomDuration(nextState);
                  if (nextState) {
                    const mins = parseInt(customInputMinutes) || 90;
                    setDurationMinutes(mins);
                  } else {
                    const initialTier = activeTiers.find((t) => t.duration_min === 60) || activeTiers[0];
                    setDurationMinutes(initialTier ? initialTier.duration_min : 60);
                  }
                }}
                className="text-[11px] text-emerald-400 hover:text-emerald-300 underline underline-offset-2 transition-colors"
              >
                {isCustomDuration ? 'Choose from Presets' : 'Custom Duration'}
              </button>
            </div>

            {!isCustomDuration ? (
              <div className={`grid gap-2 ${activeTiers.length <= 3 ? 'grid-cols-3' : 'grid-cols-2 sm:grid-cols-3'}`}>
                {activeTiers.map((tier) => {
                  const isSelected = durationMinutes === tier.duration_min;
                  return (
                    <button
                      key={tier.duration_min}
                      type="button"
                      onClick={() => setDurationMinutes(tier.duration_min)}
                      className={`py-3 px-2 text-xs font-semibold rounded-2xl border transition-all flex flex-col items-center justify-center ${
                        isSelected
                          ? 'bg-emerald-500 text-slate-950 font-bold border-emerald-400 shadow-md shadow-emerald-500/20'
                          : 'bg-slate-950 text-slate-300 border-slate-800 hover:bg-slate-800'
                      }`}
                    >
                      <span className="font-medium">{tier.label || `${tier.duration_min} mins`}</span>
                      <span
                        className={`text-xs font-mono-code font-bold mt-0.5 ${
                          isSelected ? 'text-slate-950' : 'text-emerald-400'
                        }`}
                      >
                        ₹{Number(tier.price).toFixed(0)}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="10"
                    step="5"
                    value={customInputMinutes}
                    onChange={(e) => {
                      setCustomInputMinutes(e.target.value);
                      const mins = parseInt(e.target.value) || 0;
                      setDurationMinutes(mins);
                    }}
                    placeholder="Enter minutes"
                    className="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white font-mono-code focus:outline-none focus:border-emerald-500"
                  />
                  <span className="text-xs text-slate-400 font-semibold">minutes</span>
                </div>
                <p className="text-[10px] text-slate-500">
                  Custom time calculated at ₹{(defaultHourlyRate / 60).toFixed(2)}/min (₹{defaultHourlyRate}/hr).
                </p>
              </div>
            )}
          </div>

          {/* Real-time Total Booking Summary */}
          <div className="bg-emerald-950/40 p-3.5 rounded-2xl border border-emerald-500/30 flex justify-between items-center text-xs">
            <div>
              <span className="text-slate-300 block font-medium">Total Booking Charge:</span>
              <span className="text-[10px] text-emerald-400/80">
                {matchedTier
                  ? `Tier rate (${matchedTier.label || `${matchedTier.duration_min}m`})`
                  : `Calculated from ₹${defaultHourlyRate}/hr rate`}
              </span>
            </div>
            <span className="text-xl font-black text-emerald-400 font-mono-code">
              ₹{Number(totalCost).toFixed(2)}
            </span>
          </div>

          {/* Actions */}
          <div className="pt-2 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={bookingMutation.isPending}
              className="flex-1 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-50 shadow-lg shadow-emerald-500/25 flex items-center justify-center gap-2"
            >
              <Sparkles className="w-4 h-4" />
              <span>{bookingMutation.isPending ? 'Starting...' : 'Confirm Booking'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
