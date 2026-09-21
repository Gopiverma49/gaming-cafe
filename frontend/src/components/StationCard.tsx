import React from 'react';
import {
  Gamepad2,
  Cpu,
  Sparkles,
  Clock,
  Utensils,
  Receipt,
  ArrowRightLeft,
  AlertCircle,
} from 'lucide-react';
import { StationLive } from '../types';
import { useLoungeStore } from '../store/loungeStore';
import { getStationTierVisuals } from '../constants';

interface StationCardProps {
  station: StationLive;
  isAdmin?: boolean;
  onBookStation: (station: StationLive) => void;
  onOrderFood: (station: StationLive) => void;
  onCheckout?: (station: StationLive) => void;
  onTransfer?: (station: StationLive) => void;
  onQuickExtend?: (station: StationLive, minutes: number) => void;
}

export const StationCard: React.FC<StationCardProps> = ({
  station,
  isAdmin = false,
  onBookStation,
  onOrderFood,
  onCheckout,
  onTransfer,
  onQuickExtend,
}) => {
  const { getStationFoodOrders } = useLoungeStore();

  const isAvailable = station.status === 'AVAILABLE';
  const isOccupied = station.status === 'OCCUPIED';

  // Get local food orders recorded on this station
  const stationOrders = getStationFoodOrders(station.name);
  const localFoodCharge = stationOrders.reduce((sum, item) => sum + item.total, 0);

  const serverTimeCharge = Number(station.time_charge || 0);
  const serverFoodCharge = Number(station.orders_charge || 0);
  const combinedFoodCharge = Math.max(serverFoodCharge, localFoodCharge);
  const totalAmount = serverTimeCharge + combinedFoodCharge;

  const remaining = station.remaining_minutes ?? 60;
  const isExpired = isOccupied && remaining <= 0;

  // Platform Tier Visuals & Specs
  const tierVisual = getStationTierVisuals(station?.tier);
  const tierIcon =
    station?.tier === 'CONSOLE' ? (
      <Gamepad2 className="w-4 h-4 text-blue-400" />
    ) : station?.tier === 'SIMULATOR' || station?.tier === 'VIP' ? (
      <Sparkles className={`w-4 h-4 ${tierVisual.accentColor}`} />
    ) : (
      <Cpu className="w-4 h-4 text-cyan-400" />
    );

  const pricingTiers = Array.isArray(station?.pricing_tiers) ? station.pricing_tiers : [];

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
        {/* Header: Platform Badge + Status Pill + Admin Actions */}
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
                <span>Time Expired</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
                <Clock className="w-3.5 h-3.5 text-cyan-400" />
                <span>In Match (~{remaining}m left)</span>
              </span>
            )}
          </div>
        </div>

        {/* Station Name & Rate */}
        <div className="mb-3.5">
          <div className="flex items-center justify-between">
            <h4 className="text-xl font-black text-white font-display tracking-wide">
              {station?.name || 'Station'}
            </h4>
            <span className="text-xs text-slate-400 font-sans">{tierVisual.display}</span>
          </div>

          <div className="flex items-center justify-between mt-1 flex-wrap gap-2">
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-black font-mono-code text-blue-400">
                ₹{Number(station?.default_hourly_rate || station?.hourly_rate || 0).toFixed(0)}
              </span>
              <span className="text-xs text-slate-400 font-medium">/ hour</span>
            </div>
            {pricingTiers.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap">
                {pricingTiers.map((pt, i) => (
                  <span
                    key={i}
                    className="text-[10px] font-mono-code px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold"
                  >
                    {pt?.label || `${pt?.duration_min ?? 0}m`}: ₹{pt?.price ?? 0}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Live Session Telemetry (When Station is Occupied) */}
        {isOccupied && (
          <div className="bg-slate-950/80 rounded-2xl p-3.5 border border-slate-800 mb-3.5 space-y-2">
            <div className="flex justify-between items-center text-xs text-slate-400">
              <span className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-cyan-400" />
                <span>Elapsed Play Time:</span>
              </span>
              <span className="font-mono-code text-white font-semibold">
                {station.elapsed_minutes} mins
              </span>
            </div>

            <div className="flex justify-between items-center text-xs text-slate-400">
              <span>Time Charge:</span>
              <span className="font-mono-code text-cyan-300 font-bold">
                ₹{serverTimeCharge.toFixed(2)}
              </span>
            </div>

            <div className="flex justify-between items-center text-xs text-slate-400">
              <span>Cafe Snacks & Drinks:</span>
              <span className="font-mono-code text-amber-400 font-bold">
                ₹{combinedFoodCharge.toFixed(2)}
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

      {/* Action Buttons */}
      <div className="pt-3 border-t border-slate-800 space-y-2">
        {isAvailable ? (
          <button
            onClick={() => onBookStation(station)}
            className="w-full py-3 px-4 bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-bold rounded-2xl text-xs uppercase tracking-wider transition-all shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/35 flex items-center justify-center gap-2"
          >
            <Sparkles className="w-4 h-4" />
            <span>Book Console Now</span>
          </button>
        ) : (
          <>
            {/* Primary Action on Occupied: Order Food & Drinks (Same for Customer and Admin) */}
            <button
              onClick={() => onOrderFood(station)}
              className="w-full py-2.5 px-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-bold rounded-2xl text-xs uppercase tracking-wider transition-all shadow-lg shadow-amber-500/20 hover:shadow-amber-500/35 flex items-center justify-center gap-2"
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
                    className="w-full py-2 px-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-slate-950 font-bold rounded-xl text-xs uppercase tracking-wider transition-all shadow-md flex items-center justify-center gap-1.5"
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
                      className="flex-1 py-1.5 px-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-[11px] font-semibold border border-slate-700 transition-colors flex items-center justify-center gap-1"
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
                        className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-[10px] font-mono-code border border-slate-700"
                      >
                        +30m
                      </button>
                      <button
                        onClick={() => onQuickExtend(station, 60)}
                        className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-[10px] font-mono-code border border-slate-700"
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
