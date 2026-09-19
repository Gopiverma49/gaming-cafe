import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Gamepad2,
  Clock,
  Sparkles,
  CalendarCheck,
  CalendarClock,
  XCircle,
  Coffee,
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useLoungeStore, AdvanceBooking } from '../store/loungeStore';
import { useNotificationStore } from '../store/notificationStore';
import { fetchLiveStations, checkInStation } from '../api';
import { StationLive } from '../types';

export const CustomerPortal: React.FC = () => {
  const { user } = useAuthStore();
  const {
    stationGames,
    bookings,
    addBooking,
    cancelBooking,
  } = useLoungeStore();

  // Seat Booking Modal State
  const [selectedStationForBooking, setSelectedStationForBooking] = useState<StationLive | null>(null);
  const [bookingType, setBookingType] = useState<'NOW' | 'ADVANCE'>('NOW');
  const [bookingDuration, setBookingDuration] = useState<number>(60);
  const [advanceTimeSlot, setAdvanceTimeSlot] = useState<string>('');
  const [bookingConfirmedNotice, setBookingConfirmedNotice] = useState<AdvanceBooking | null>(null);

  // Fetch live stations
  const { data: stations = [] } = useQuery<StationLive[]>({
    queryKey: ['stations-live'],
    queryFn: fetchLiveStations,
    refetchInterval: 8000,
  });

  const availableStations = stations.filter((s) => s.status === 'AVAILABLE');

  // Calculate estimated vacancy time for an occupied station
  const calculateVacancy = (station: StationLive) => {
    const remaining = station.remaining_minutes ?? 45;
    const now = new Date();
    const freeTime = new Date(now.getTime() + remaining * 60000);
    const timeString = freeTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    return {
      minutesRemaining: remaining,
      timeString,
    };
  };

  const openBookingModal = (station: StationLive, type: 'NOW' | 'ADVANCE') => {
    setSelectedStationForBooking(station);
    setBookingType(type);
    setBookingDuration(60);

    if (type === 'ADVANCE') {
      const vacancy = calculateVacancy(station);
      setAdvanceTimeSlot(`Today at ${vacancy.timeString} (When current session ends)`);
    } else {
      setAdvanceTimeSlot('Immediate Access (Ready Right Now)');
    }
  };

  const queryClient = useQueryClient();
  const { addNotification } = useNotificationStore();

  const handleConfirmBooking = async () => {
    if (!selectedStationForBooking) return;

    const rate = Number(selectedStationForBooking.hourly_rate);
    const total = rate * (bookingDuration / 60);

    const created = addBooking({
      stationId: selectedStationForBooking.id,
      stationName: selectedStationForBooking.name,
      customerName: user?.name || 'Player',
      customerPhone: user?.phone,
      bookingType,
      scheduledTime: advanceTimeSlot || 'Immediate Access',
      durationMinutes: bookingDuration,
      hourlyRate: rate,
      totalCost: total,
      status: 'CONFIRMED',
    });

    if (bookingType === 'NOW') {
      try {
        await checkInStation(selectedStationForBooking.id, bookingDuration);
        queryClient.invalidateQueries({ queryKey: ['stations-live'] });
      } catch (err) {
        console.warn('Backend live session sync:', err);
      }
      addNotification(
        'BOOKING',
        '🎮 Station Booked & Active!',
        `${user?.name || 'Customer'} just booked ${selectedStationForBooking.name} for ${bookingDuration / 60} hr(s).`
      );
    } else {
      addNotification(
        'BOOKING',
        '📅 New Advance Reservation!',
        `${user?.name || 'Customer'} reserved ${selectedStationForBooking.name} for ${advanceTimeSlot} (${bookingDuration / 60} hr).`
      );
    }

    setBookingConfirmedNotice(created);
    setSelectedStationForBooking(null);
  };


  // My personal active bookings
  const myBookings = bookings.filter(
    (b) => b.customerName === user?.name || b.customerName === user?.username
  );

  return (
    <div className="space-y-8 relative z-10">
      {/* ========================================================================= */}
      {/* 1. TOP WELCOME & DUAL EXPERIENCE HERO (GAMING + CAFE) */}
      {/* ========================================================================= */}
      <div className="relative overflow-hidden rounded-3xl bg-white/80 dark:bg-[#0c1424]/90 backdrop-blur-2xl border border-slate-200/90 dark:border-slate-800 p-6 sm:p-8 shadow-[0_15px_40px_-5px_rgba(0,0,0,0.05)] dark:shadow-2xl">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/25 text-blue-700 dark:text-blue-400 text-xs font-bold font-display tracking-wide">
                <Gamepad2 className="w-3.5 h-3.5" />
                PlayStation 5 Lounge
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-800 dark:text-amber-400 text-xs font-bold font-display tracking-wide">
                <Coffee className="w-3.5 h-3.5" />
                Kitchen & Bar
              </span>
              {user?.phone && (
                <span className="text-xs text-slate-400 font-mono-code">
                  • {user.phone}
                </span>
              )}
            </div>

            <h2 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white font-display tracking-wide">
              Welcome to the Lounge, {user?.name || 'Gamer'}!
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 max-w-2xl leading-relaxed">
              High-performance 4K PS5 gaming meets elevated comfort food. Savor gourmet snacks, craft coffee, and chilled refreshments brought directly to your setup
            </p>
          </div>

          {/* Quick Stat Pill */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/80 border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
                <Gamepad2 className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  Live Console Availability
                </div>
                <div className="text-base font-black text-slate-900 dark:text-white font-mono-code">
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                    {availableStations.length} of 3
                  </span>{' '}
                  Consoles Free
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Alerts */}
      {bookingConfirmedNotice && (
        <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-300 dark:border-emerald-500/60 text-emerald-900 dark:text-emerald-200 flex items-start justify-between shadow-lg animate-in fade-in">
          <div className="flex items-start gap-3">
            <CalendarCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-bold text-sm text-emerald-900 dark:text-white">
                Seat Booking Confirmed! Code: {bookingConfirmedNotice.id}
              </h4>
              <p className="text-xs text-emerald-700 dark:text-emerald-300/90 mt-0.5">
                Reserved <strong>{bookingConfirmedNotice.stationName}</strong> for{' '}
                <strong>{bookingConfirmedNotice.scheduledTime}</strong> ({bookingConfirmedNotice.durationMinutes / 60} hour(s)). Station is locked for your session.
              </p>
            </div>
          </div>
          <button
            onClick={() => setBookingConfirmedNotice(null)}
            className="text-emerald-700 dark:text-emerald-400 hover:text-emerald-900 dark:hover:text-white text-xs p-1"
          >
            ✕
          </button>
        </div>
      )}


      {/* ========================================================================= */}
      {/* 2. PLAYSTATION 5 CONSOLES SECTION (PS1, PS2, PS3) */}
      {/* ========================================================================= */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <Gamepad2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white font-display">
                PlayStation 5 Console Stations
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                DualSense wireless controllers, 65″ 4K 120Hz OLED, surround sound headsets
              </p>
            </div>
          </div>

          <div className="text-xs font-mono-code font-bold text-slate-500 dark:text-slate-400">
            {availableStations.length} consoles available right now
          </div>
        </div>

        {/* 3 Console Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {stations.map((station) => {
            const isAvailable = station.status === 'AVAILABLE';
            const vacancy = calculateVacancy(station);
            const games =
              stationGames[station.id] ||
              stationGames['default_ps5'] ||
              ['EA Sports FC 24', 'Spider-Man 2', 'Tekken 8', 'Mortal Kombat 1'];

            return (
              <div
                key={station.id}
                className={`bg-white/90 dark:bg-slate-900/85 backdrop-blur-xl p-6 rounded-3xl border transition-all duration-300 flex flex-col justify-between shadow-sm hover:shadow-xl ${
                  isAvailable
                    ? 'border-emerald-300 dark:border-emerald-500/40 hover:border-emerald-500 hover:shadow-emerald-500/10'
                    : 'border-slate-200 dark:border-slate-800 hover:border-cyan-400'
                }`}
              >
                <div>
                  {/* Card Header: Platform Tag + Status Pill */}
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span className="text-[11px] font-mono-code font-bold uppercase px-2.5 py-0.5 rounded-full bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/20">
                      PS5 Console
                    </span>

                    {isAvailable ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-500/30">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                        <span>Free to Play</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-cyan-50 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-500/30">
                        <Clock className="w-3.5 h-3.5 text-cyan-500" />
                        <span>In Match</span>
                      </span>
                    )}
                  </div>

                  {/* Station Name & Rate */}
                  <div className="mb-3">
                    <h4 className="text-xl font-black text-slate-900 dark:text-white font-display flex items-center justify-between">
                      <span>{station.name}</span>
                      <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 font-sans font-normal">
                        65″ 4K 120Hz
                      </span>
                    </h4>
                    <div className="flex items-baseline gap-1 mt-1">
                      <span className="text-2xl font-black font-mono-code text-blue-600 dark:text-blue-400">
                        ₹{Number(station.hourly_rate).toFixed(0)}
                      </span>
                      <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">/ hour</span>
                    </div>
                  </div>

                  {/* Future Vacancy Forecast for Busy Stations */}
                  {!isAvailable && (
                    <div className="bg-slate-50 dark:bg-slate-950/80 rounded-2xl p-3 border border-slate-200 dark:border-slate-800 mb-3 space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-amber-500" />
                          Expected Free In:
                        </span>
                        <span className="font-bold text-amber-600 dark:text-amber-400 font-mono-code">
                          ~{vacancy.minutesRemaining} mins
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-600 dark:text-slate-300 font-mono-code flex justify-between">
                        <span>Free At:</span>
                        <span className="text-cyan-600 dark:text-cyan-300 font-semibold">{vacancy.timeString}</span>
                      </div>
                    </div>
                  )}

                  {/* Installed Games List */}
                  <div className="mb-4">
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block mb-1.5 font-semibold">
                      Installed Titles:
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {games.slice(0, 3).map((g) => (
                        <span
                          key={g}
                          className="text-[10px] px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 font-medium"
                        >
                          {g}
                        </span>
                      ))}
                      {games.length > 3 && (
                        <span className="text-[10px] px-2 py-1 rounded-lg text-slate-400">
                          +{games.length - 3} more
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Booking Action Buttons */}
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
                  {isAvailable ? (
                    <button
                      onClick={() => openBookingModal(station, 'NOW')}
                      className="w-full py-3 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold rounded-2xl text-xs uppercase tracking-wider transition-all shadow-lg shadow-blue-500/20 hover:shadow-blue-500/35 flex items-center justify-center gap-2"
                    >
                      <Sparkles className="w-4 h-4" />
                      <span>Book Console Now</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => openBookingModal(station, 'ADVANCE')}
                      className="w-full py-3 px-4 bg-slate-100 dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-cyan-300 border border-slate-300 dark:border-cyan-500/40 font-bold rounded-2xl text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2"
                    >
                      <CalendarClock className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                      <span>Reserve for {vacancy.timeString}</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>



      {/* ========================================================================= */}
      {/* 4. MY ACTIVE RESERVATIONS DRAWER */}
      {/* ========================================================================= */}
      {myBookings.length > 0 && (
        <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl p-6 rounded-3xl border border-blue-200/80 dark:border-blue-900/40 space-y-3">
          <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <CalendarCheck className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span>My Active Seat Reservations</span>
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {myBookings.map((b) => (
              <div
                key={b.id}
                className="bg-slate-50 dark:bg-slate-950/80 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 text-xs space-y-1.5"
              >
                <div className="flex justify-between items-center">
                  <span className="font-bold text-blue-600 dark:text-blue-400 font-mono-code">{b.id}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30 font-bold">
                    {b.status}
                  </span>
                </div>
                <div className="text-slate-900 dark:text-white font-bold text-sm">{b.stationName}</div>
                <div className="text-slate-500 dark:text-slate-400 text-[11px] font-mono-code">
                  Scheduled: <span className="text-slate-800 dark:text-slate-200">{b.scheduledTime}</span>
                </div>
                <div className="flex justify-between items-center pt-1 border-t border-slate-200 dark:border-slate-800">
                  <span className="text-slate-500 dark:text-slate-400">{b.durationMinutes / 60} hr play time</span>
                  <button
                    onClick={() => cancelBooking(b.id)}
                    className="text-rose-500 hover:text-rose-600 dark:hover:text-rose-300 text-[11px] font-semibold"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: SEAT BOOKING MODAL */}
      {/* ========================================================================= */}
      {selectedStationForBooking && (
        <div className="fixed inset-0 z-50 bg-black/60 dark:bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white dark:bg-slate-900 max-w-md w-full rounded-t-3xl sm:rounded-3xl p-6 border border-slate-200 dark:border-blue-500/40 shadow-2xl relative animate-in slide-in-from-bottom-5 max-h-[90vh] overflow-y-auto pb-safe">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center space-x-2">
                <Gamepad2 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white font-display">
                  {bookingType === 'NOW' ? 'Instant Console Booking' : 'Advance Seat Reservation'}
                </h3>
              </div>
              <button
                onClick={() => setSelectedStationForBooking(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white p-1"
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>

            <div className="space-y-4 text-sm">
              <div className="bg-slate-50 dark:bg-slate-950 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 text-xs space-y-1.5">
                <div className="flex justify-between text-slate-500 dark:text-slate-400">
                  <span>Selected Station:</span>
                  <span className="text-slate-900 dark:text-white font-bold">{selectedStationForBooking.name}</span>
                </div>
                <div className="flex justify-between text-slate-500 dark:text-slate-400">
                  <span>Display & Gear:</span>
                  <span className="text-slate-800 dark:text-slate-200 font-semibold">65″ 4K 120Hz OLED + DualSense</span>
                </div>
                <div className="flex justify-between text-slate-500 dark:text-slate-400">
                  <span>Hourly Rate:</span>
                  <span className="text-blue-600 dark:text-blue-400 font-mono-code font-bold">
                    ₹{Number(selectedStationForBooking.hourly_rate).toFixed(2)}/hr
                  </span>
                </div>
              </div>

              {bookingType === 'ADVANCE' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    Reservation Time Slot:
                  </label>
                  <select
                    value={advanceTimeSlot}
                    onChange={(e) => setAdvanceTimeSlot(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-cyan-500/40 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value={advanceTimeSlot}>
                      {advanceTimeSlot || 'Next available vacancy'}
                    </option>
                    <option value="Tonight at 09:00 PM">Tonight at 09:00 PM</option>
                    <option value="Tonight at 10:00 PM">Tonight at 10:00 PM</option>
                    <option value="Tomorrow at 02:00 PM">Tomorrow at 02:00 PM</option>
                    <option value="Tomorrow at 06:00 PM">Tomorrow at 06:00 PM</option>
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  Select Play Duration:
                </label>
                <div className="grid grid-cols-3 gap-2.5">
                  {[
                    { mins: 60, label: '1 Hour' },
                    { mins: 120, label: '2 Hours' },
                    { mins: 180, label: '3 Hours' },
                  ].map((option) => (
                    <button
                      key={option.mins}
                      type="button"
                      onClick={() => setBookingDuration(option.mins)}
                      className={`py-3 text-xs font-semibold rounded-2xl border transition-all flex flex-col items-center justify-center ${
                        bookingDuration === option.mins
                          ? 'bg-blue-600 text-white font-bold border-blue-500 shadow-md shadow-blue-500/20'
                          : 'bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span>{option.label}</span>
                      <span className="text-[10px] opacity-80 font-mono-code">
                        ₹{(Number(selectedStationForBooking.hourly_rate) * (option.mins / 60)).toFixed(0)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Total Summary */}
              <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 flex justify-between items-center text-xs">
                <span className="text-slate-500 dark:text-slate-400">Total Booking Amount:</span>
                <span className="text-base font-bold text-blue-600 dark:text-blue-400 font-mono-code">
                  ₹{(Number(selectedStationForBooking.hourly_rate) * (bookingDuration / 60)).toFixed(2)}
                </span>
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  onClick={() => setSelectedStationForBooking(null)}
                  className="flex-1 py-3 rounded-2xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold border border-slate-200 dark:border-slate-700"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmBooking}
                  className="flex-1 py-3 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-lg shadow-blue-500/25"
                >
                  Confirm Reservation
                </button>
              </div>
            </div>
          </div>
        </div>
      )}


    </div>
  );
};
