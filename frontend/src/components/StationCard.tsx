import React, { useState, useEffect } from 'react';
import {
  Gamepad2,
  Cpu,
  Sparkles,
  Clock,
  Utensils,
  Receipt,
  ArrowRightLeft,
  AlertCircle,
  Hourglass,
} from 'lucide-react';
import { StationLive, PricingTier } from '../types';
import { getStationTierVisuals } from '../constants';

interface StationCardProps {
  station: StationLive;
  isAdmin?: boolean;
  onBookStation?: (station: StationLive) => void;
  onSelectTier?: (station: StationLive, tier: PricingTier) => void;
  onOrderFood: (station: StationLive) => void;
  onCheckout?: (station: StationLive) => void;
  onTransfer?: (station: StationLive) => void;
  onQuickExtend?: (station: StationLive, minutes: number) => void;
}

export const StationCard: React.FC<StationCardProps> = ({
  station,
  isAdmin = false,
  onBookStation,
  onSelectTier,
  onOrderFood,
  onCheckout,
  onTransfer,
  onQuickExtend,
}) => {
  const isAvailable = station?.status === 'AVAILABLE';
  const isOccupied = station?.status === 'OCCUPIED';

  // Running bills purely reflect real SQLite live station values
  const timeCharge = Number(station?.time_charge || 0);
  const foodCharge = Number(station?.orders_charge || 0);
  const totalAmount = Number(station?.running_total ?? (timeCharge + foodCharge));

  // Real-time MM:SS Countdown Timer
  const [secondsRemaining, setSecondsRemaining] = useState<number>(() => {
    return Math.max(0, (station?.remaining_minutes ?? 60) * 60);
  });

  useEffect(() => {
    setSecondsRemaining(Math.max(0, (station?.remaining_minutes ?? 60) * 60));
  }, [station?.remaining_minutes]);

  useEffect(() => {
    if (!isOccupied) return;
    const interval = setInterval(() => {
      setSecondsRemaining((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [isOccupied]);

  const mins = Math.floor(secondsRemaining / 60);
  const secs = secondsRemaining % 60;
  const formattedCountdown = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  const isExpired = isOccupied && secondsRemaining <= 0;

  // Platform Tier Visuals & Specs (Hardware spec display text intentionally removed as requested)
  const tierVisual = getStationTierVisuals(station?.tier);
  const tierIcon =
    station?.tier === 'CONSOLE' ? (
      <Gamepad2 className="w-4 h-4 text-blue-400" />
    ) : station?.tier === 'SIMULATOR' || station?.tier === 'VIP' ? (
      <Sparkles className={`w-4 h-4 ${tierVisual.accentColor}`} />
    ) : (
      <Cpu className="w-4 h-4 text-cyan-400" />
    );

  // Dynamic pricing tiers with fallback if empty
  const rawPricingTiers = Array.isArray(station?.pricing_tiers) ? station.pricing_tiers : [];
  const pricingTiers: PricingTier[] = rawPricingTiers.length > 0
    ? rawPricingTiers
    : [
        { duration_min: 30, price: Math.round(Number(station?.hourly_rate || 180) * 0.5), label: '30 mins' },
        { duration_min: 60, price: Number(station?.hourly_rate || 180), label: '1 hr' },
        { duration_min: 120, price: Math.round(Number(station?.hourly_rate || 180) * 1.8), label: '2 hrs' },
      ];

  const handleTierClick = (pt: PricingTier) => {
    if (onSelectTier) {
      onSelectTier(station, pt);
    } else if (onBookStation) {
      onBookStation(station);
    }
  };

  return (
    <div
      className={`bg-slate-900/85 backdrop-blur-xl p-5 sm:p-6 rounded-3xl border transition-all duration-300 flex flex-col justify-between shadow-lg hover:shadow-2xl ${
        isAvailable
          ? 'border-emerald-500/30 hover:border-emerald-500/60 hover:shadow-emerald-500/10'
          : isExpired
          ? 'border-rose-500/50 hover:border-rose-500 shadow-rose-500/10'
          : 'border-cyan-500/30 hover:border-cyan-500/60 hover:shadow-cyan-500/10'
      }`}
    >
      <div>
        {/* Header: Platform Badge + Live Status / Countdown Pill */}
        <div className="flex items-center justify-between gap-2 mb-3.5">
          <div className="flex items-center gap-1.5">
            <span
              className={`inline-flex items-center gap-1.5 text-[11px] font-mono-code font-bold uppercase px-2.5 py-1 rounded-full border ${tierVisual.badge}`}
            >
              {tierIcon}
              <span>{tierVisual.label}</span>
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {isAvailable ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>Available</span>
              </span>
            ) : isExpired ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-rose-500/15 text-rose-400 border border-rose-500/30 animate-pulse">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>Time Expired (00:00)</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/40 font-mono-code shadow-sm">
                <Hourglass className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
                <span>{formattedCountdown} left</span>
              </span>
            )}
          </div>
        </div>

        {/* Station Name & Base Hourly Rate (Hardware specs subtitle removed as requested) */}
        <div className="mb-4">
          <div className="flex items-center justify-between">
            <h4 className="text-xl font-black text-white font-display tracking-wide">
              {station?.name || 'Station'}
            </h4>
            <div className="flex items-baseline gap-1">
              <span className="text-xl font-black font-mono-code text-blue-400">
                ₹{Number(station?.default_hourly_rate || station?.hourly_rate || 180).toFixed(0)}
              </span>
              <span className="text-xs text-slate-400 font-medium">/ hr</span>
            </div>
          </div>
        </div>

        {/* Live Session Telemetry (When Station is Occupied) */}
        {isOccupied && (
          <div className="bg-slate-950/80 rounded-2xl p-3.5 border border-slate-800 mb-3.5 space-y-2">
            <div className="flex justify-between items-center text-xs text-slate-400">
              <span className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-cyan-400" />
                <span>Match Session Time:</span>
              </span>
              <span className="font-mono-code text-cyan-300 font-bold">
                {formattedCountdown} ({station?.elapsed_minutes ?? 0}m elapsed)
              </span>
            </div>

            <div className="flex justify-between items-center text-xs text-slate-400">
              <span>Play Time Charge:</span>
              <span className="font-mono-code text-cyan-300 font-semibold">
                ₹{timeCharge.toFixed(2)}
              </span>
            </div>

            <div className="flex justify-between items-center text-xs text-slate-400">
              <span>Snacks &amp; Drinks:</span>
              <span className="font-mono-code text-amber-400 font-semibold">
                ₹{foodCharge.toFixed(2)}
              </span>
            </div>

            <div className="flex justify-between items-center text-xs pt-1.5 border-t border-slate-800">
              <span className="text-white font-semibold">Total Billable:</span>
              <span className="text-emerald-400 font-mono-code font-bold text-sm">
                ₹{totalAmount.toFixed(2)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Dynamic Action Buttons */}
      <div className="pt-3 border-t border-slate-800 space-y-2.5">
        {isAvailable ? (
          <div>
            <div className="text-[11px] font-mono-code uppercase text-slate-400 mb-2 font-bold flex items-center justify-between">
              <span>Select Session Duration:</span>
              <span className="text-emerald-400 text-[10px] font-normal">Tap to customize</span>
            </div>
            
            {/* Dynamic Duration Buttons populated directly from station.pricing_tiers */}
            <div className="grid grid-cols-3 gap-2">
              {pricingTiers.map((pt, i) => (
                <button
                  key={i}
                  onClick={() => handleTierClick(pt)}
                  className="py-2.5 px-2 rounded-xl bg-slate-950 hover:bg-blue-600/20 border border-slate-800 hover:border-blue-500/60 text-white font-bold transition-all flex flex-col items-center justify-center gap-0.5 shadow-sm group active:scale-95"
                  title={`Start session: ${pt.label || `${pt.duration_min}m`}`}
                >
                  <span className="text-xs font-display tracking-wide group-hover:text-blue-300 transition-colors">
                    {pt.label || `${pt.duration_min} mins`}
                  </span>
                  <span className="text-[11px] font-mono-code font-bold text-emerald-400">
                    ₹{Number(pt.price).toFixed(0)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {/* Primary Action on Occupied: Order Food & Drinks */}
            <button
              onClick={() => onOrderFood(station)}
              className="w-full py-2.5 px-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-bold rounded-2xl text-xs uppercase tracking-wider transition-all shadow-lg shadow-amber-500/20 hover:shadow-amber-500/35 flex items-center justify-center gap-2 cursor-pointer active:scale-95"
            >
              <Utensils className="w-4 h-4" />
              <span>Order Food & Drinks</span>
            </button>

            {/* Admin-only Operations */}
            {isAdmin && (
              <div className="space-y-2 pt-1">
                {/* Generate Bill & Settle Invoice */}
                {onCheckout && (
                  <button
                    onClick={() => onCheckout(station)}
                    className="w-full py-2 px-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-slate-950 font-bold rounded-xl text-xs uppercase tracking-wider transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Receipt className="w-3.5 h-3.5 text-slate-950" />
                    <span>Generate Bill & Checkout</span>
                  </button>
                )}

                {/* Transfer Station & Quick Extend */}
                <div className="flex items-center justify-between gap-2 pt-0.5">
                  {onTransfer && (
                    <button
                      onClick={() => onTransfer(station)}
                      className="flex-1 py-1.5 px-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-[11px] font-semibold border border-slate-700 transition-colors flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <ArrowRightLeft className="w-3 h-3 text-blue-400" />
                      <span>Transfer</span>
                    </button>
                  )}

                  {onQuickExtend && (
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-[10px] text-slate-400">Extend:</span>
                      <button
                        onClick={() => onQuickExtend(station, 30)}
                        className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-[10px] font-mono-code border border-slate-700 cursor-pointer"
                      >
                        +30m
                      </button>
                      <button
                        onClick={() => onQuickExtend(station, 60)}
                        className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-[10px] font-mono-code border border-slate-700 cursor-pointer"
                      >
                        +1h
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
