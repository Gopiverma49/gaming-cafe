import React, { useState, useEffect } from 'react';
import {
  Gamepad2,
  Clock,
  Utensils,
  Hourglass,
  Sparkles,
} from 'lucide-react';
import { StationLive } from '../types';

interface ActiveReservationsTrayProps {
  myStations: StationLive[];
  onOrderFood: (station: StationLive) => void;
}

export const ActiveReservationsTray: React.FC<ActiveReservationsTrayProps> = ({
  myStations,
  onOrderFood,
}) => {
  if (!myStations || myStations.length === 0) return null;

  return (
    <div className="bg-gradient-to-r from-blue-950/40 via-indigo-950/30 to-purple-950/40 border border-blue-500/30 rounded-3xl p-5 sm:p-6 shadow-2xl relative overflow-hidden backdrop-blur-xl mb-6">
      {/* Glow highlight */}
      <div className="absolute -top-12 -right-12 w-48 h-48 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Tray Header */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-blue-500/20 border border-blue-400/30 flex items-center justify-center text-blue-400">
            <Sparkles className="w-4 h-4 animate-pulse" />
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-black text-white font-display tracking-wide">
              My Active Reservations
            </h3>
            <p className="text-xs text-blue-200/70">
              Live match timer, billing breakdown &amp; desk food ordering
            </p>
          </div>
        </div>

        <span className="inline-flex items-center gap-1.5 text-xs font-mono-code font-bold px-2.5 py-1 rounded-full bg-blue-500/20 text-blue-300 border border-blue-400/30">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          <span>{myStations.length} Active</span>
        </span>
      </div>

      {/* Active Stations Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {myStations.map((station) => (
          <ActiveReservationCard
            key={station.id}
            station={station}
            onOrderFood={() => onOrderFood(station)}
          />
        ))}
      </div>
    </div>
  );
};

const ActiveReservationCard: React.FC<{
  station: StationLive;
  onOrderFood: () => void;
}> = ({ station, onOrderFood }) => {
  const [secondsRemaining, setSecondsRemaining] = useState<number>(() => {
    return Math.max(0, (station?.remaining_minutes ?? 60) * 60);
  });

  useEffect(() => {
    setSecondsRemaining(Math.max(0, (station?.remaining_minutes ?? 60) * 60));
  }, [station?.remaining_minutes]);

  useEffect(() => {
    const interval = setInterval(() => {
      setSecondsRemaining((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const mins = Math.floor(secondsRemaining / 60);
  const secs = secondsRemaining % 60;
  const formattedCountdown = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  const timeCharge = Number(station?.time_charge || 0);
  const foodCharge = Number(station?.orders_charge || 0);
  const totalAmount = Number(station?.running_total ?? (timeCharge + foodCharge));

  return (
    <div className="bg-slate-950/80 border border-blue-500/20 rounded-2xl p-4 flex flex-col justify-between gap-3 shadow-lg">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Gamepad2 className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-bold text-white font-display">
            {station.name}
          </span>
        </div>

        <span className="inline-flex items-center gap-1.5 text-xs font-mono-code font-bold px-2.5 py-1 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/40">
          <Hourglass className="w-3 h-3 text-cyan-400 animate-spin" />
          <span>{formattedCountdown} left</span>
        </span>
      </div>

      {/* Financials & Telemetry Breakdown */}
      <div className="bg-slate-900/60 rounded-xl p-3 border border-slate-800 space-y-1.5 text-xs">
        <div className="flex justify-between items-center text-slate-400">
          <span className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-cyan-400" />
            <span>Time Elapsed:</span>
          </span>
          <span className="font-mono-code text-cyan-300 font-bold">
            {station?.elapsed_minutes ?? 0}m
          </span>
        </div>

        <div className="flex justify-between items-center text-slate-400">
          <span>Play Time Charge:</span>
          <span className="font-mono-code text-cyan-300 font-semibold">
            ₹{timeCharge.toFixed(2)}
          </span>
        </div>

        <div className="flex justify-between items-center text-slate-400">
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

      {/* CTA: Order Food & Drinks */}
      <button
        onClick={onOrderFood}
        className="w-full py-2.5 px-4 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-bold rounded-xl text-xs uppercase tracking-wider transition-all shadow-md hover:shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 cursor-pointer active:scale-95"
      >
        <Utensils className="w-4 h-4 text-slate-950" />
        <span>Order Food &amp; Drinks</span>
      </button>
    </div>
  );
};
