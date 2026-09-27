/**
 * Dynamic Conflict & Collision Prevention Engine
 * for Vanya Gaming Lounge Advance Bookings & Walk-in Sessions.
 */

import { AdvanceBooking } from '../store/loungeStore';

export interface TimeInterval {
  start: Date;
  end: Date;
  label?: string;
  id?: string;
}

export interface CollisionResult {
  hasConflict: boolean;
  conflictingBooking?: AdvanceBooking;
  conflictingInterval?: TimeInterval;
  reason?: string;
}

/**
 * Parses YYYY-MM-DD and HH:mm or combined ISO YYYY-MM-DDTHH:mm into a JavaScript Date object.
 */
export function parseBookingDateTime(dateStr: string, timeStr?: string): Date {
  if (!dateStr) return new Date();
  if (dateStr.includes('T') && !timeStr) {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d;
  }
  const cleanDateStr = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
  const rawTimeStr = timeStr || (dateStr.includes('T') ? dateStr.split('T')[1] : '00:00');

  const [year, month, day] = cleanDateStr.split('-').map(Number);

  let isPM = false;
  let cleanTime = (rawTimeStr || '00:00').trim().toUpperCase();
  if (cleanTime.includes('PM')) {
    isPM = true;
    cleanTime = cleanTime.replace('PM', '').trim();
  } else if (cleanTime.includes('AM')) {
    cleanTime = cleanTime.replace('AM', '').trim();
  }
  const parts = cleanTime.split(':').map((x) => parseInt(x, 10) || 0);
  let hours = parts[0] || 0;
  const minutes = parts[1] || 0;
  if (isPM && hours < 12) hours += 12;
  if (!isPM && cleanTime.includes('AM') && hours === 12) hours = 0;

  return new Date(year, (month || 1) - 1, day || 1, hours, minutes, 0, 0);
}

/**
 * Calculates end time string HH:mm given start time string and duration in minutes.
 */
export function calculateEndTime(startTimeStr: string, durationMinutes: number): string {
  if (!startTimeStr) return '00:00';
  const cleanTime = startTimeStr.includes('T') ? startTimeStr.split('T')[1] : startTimeStr;
  const [hStr, mStr] = cleanTime.split(':');
  const h = parseInt(hStr, 10) || 0;
  const m = parseInt(mStr || '0', 10) || 0;
  const totalMins = h * 60 + m + (durationMinutes || 0);
  const endH = Math.floor(totalMins / 60) % 24;
  const endM = totalMins % 60;
  return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
}

/**
 * Formats HH:mm into standard 12-hour AM/PM format (e.g. 10:00 -> 10:00 AM).
 */
export function formatTime12h(timeStr: string): string {
  if (!timeStr) return '';
  const cleanTime = timeStr.includes('T') ? timeStr.split('T')[1] : timeStr;
  const [hStr, mStr] = cleanTime.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr || '0', 10);
  if (isNaN(h)) return timeStr;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const displayH = h % 12 || 12;
  return `${displayH}:${String(m).padStart(2, '0')} ${ampm}`;
}

/**
 * Returns ISO date string YYYY-MM-DD for a given Date.
 */
export function toISODateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function checkTimeCollision(
  startA: Date,
  endA: Date,
  startB: Date,
  endB: Date
): boolean {
  return startA.getTime() < endB.getTime() && endA.getTime() > startB.getTime();
}

/**
 * Rate card pricing calculation according to mode and duration (fallback).
 */
export function calculateFareForMode(mode: string, durationMinutes: number): number {
  const normMode = (mode || '').toLowerCase();

  let baseHourly = 180;
  if (normMode.includes('multi')) {
    baseHourly = 220;
  } else if (normMode.includes('car')) {
    baseHourly = 250;
  } else if (normMode.includes('vr')) {
    baseHourly = 300;
  }

  if (durationMinutes === 30) {
    if (baseHourly === 180) return 100;
    if (baseHourly === 220) return 120;
    if (baseHourly === 250) return 140;
    return 165;
  }
  if (durationMinutes === 60) {
    return baseHourly;
  }
  if (durationMinutes === 120) {
    if (baseHourly === 180) return 320;
    if (baseHourly === 220) return 400;
    if (baseHourly === 250) return 450;
    return 540;
  }

  return Math.round((baseHourly * durationMinutes) / 60);
}

/**
 * Computes exact fare dynamically synced with what the admin has set
 * for each station and mode in matrix/manage station.
 */
export function getAdminConfiguredFare(
  stationId: string,
  modeName: string,
  durationMinutes: number,
  matrixData?: { modes?: any[]; stations?: any[] }
): number {
  if (!matrixData) return calculateFareForMode(modeName, durationMinutes);

  const normMode = (modeName || '').trim().toLowerCase();
  const normStation = (stationId || '').trim().toUpperCase();

  // 1. Check modes configured in matrixData.modes
  if (Array.isArray(matrixData.modes)) {
    const matchedMode = matrixData.modes.find((m) => {
      const mId = (m.id || '').toLowerCase();
      const mName = (m.name || '').toLowerCase();
      return mId === normMode || mName === normMode || mName.includes(normMode) || normMode.includes(mName);
    });

    if (matchedMode) {
      if (Array.isArray(matchedMode.pricing_tiers) && matchedMode.pricing_tiers.length > 0) {
        const tier = matchedMode.pricing_tiers.find((t: any) => t.duration_min === durationMinutes);
        if (tier && Number(tier.price) > 0) {
          return Number(tier.price);
        }
      }
      if (matchedMode.hourly_rate && Number(matchedMode.hourly_rate) > 0) {
        const rate = Number(matchedMode.hourly_rate);
        if (durationMinutes === 30) return Math.round(rate * 0.55);
        if (durationMinutes === 60) return rate;
        if (durationMinutes === 120) return Math.round(rate * 1.8);
        return Math.round((rate * durationMinutes) / 60);
      }
    }
  }

  // 2. Check stations configured in matrixData.stations
  if (Array.isArray(matrixData.stations)) {
    const matchedStation = matrixData.stations.find((s) => {
      return (s.name || s.id || '').toUpperCase().trim() === normStation;
    });

    if (matchedStation) {
      if (Array.isArray(matchedStation.pricing_tiers) && matchedStation.pricing_tiers.length > 0) {
        const tier = matchedStation.pricing_tiers.find((t: any) => t.duration_min === durationMinutes);
        if (tier && Number(tier.price) > 0) {
          return Number(tier.price);
        }
      }
      if (matchedStation.hourly_rate && Number(matchedStation.hourly_rate) > 0) {
        const rate = Number(matchedStation.hourly_rate);
        if (durationMinutes === 30) return Math.round(rate * 0.55);
        if (durationMinutes === 60) return rate;
        if (durationMinutes === 120) return Math.round(rate * 1.8);
        return Math.round((rate * durationMinutes) / 60);
      }
    }
  }

  return calculateFareForMode(modeName, durationMinutes);
}

/**
 * Finds the earliest upcoming confirmed booking on a station from a given reference time.
 */
export function getNextBookingForStation(
  stationId: string,
  bookings: AdvanceBooking[],
  fromTime: Date = new Date()
): { booking: AdvanceBooking; start: Date; end: Date; diffMinutes: number } | null {
  if (!Array.isArray(bookings) || bookings.length === 0) return null;

  const targetStation = (stationId || '').toUpperCase().trim();
  const fromMs = fromTime.getTime();

  const relevant = bookings
    .filter((b) => {
      const bStatus = String(b.status || '').toUpperCase().trim();
      if (bStatus !== 'CONFIRMED') return false;
      const bStation = (b.stationId || '').toUpperCase().trim();
      return bStation === targetStation;
    })
    .map((b) => {
      const start = parseBookingDateTime(b.bookingDate, b.startTime);
      const end = parseBookingDateTime(b.bookingDate, b.endTime);
      return { booking: b, start, end, diffMinutes: Math.floor((start.getTime() - fromMs) / 60000) };
    })
    // Only future or current bookings that haven't ended yet
    .filter((item) => item.end.getTime() > fromMs && item.start.getTime() >= fromMs - 5 * 60000)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  return relevant.length > 0 ? relevant[0] : null;
}


/**
 * Operational Scenario 1: Walk-In Starting Overlap Protection
 * Blocks session start if projectedEndTime overlaps with any confirmed booking.
 */
export function validateWalkInDuration(
  stationId: string,
  durationMinutes: number,
  bookings: AdvanceBooking[],
  fromTime: Date = new Date()
): {
  allowed: boolean;
  reason?: string;
  nextBooking?: AdvanceBooking;
  maxAvailableMinutes?: number;
  conflictBookingTimeStr?: string;
} {
  const next = getNextBookingForStation(stationId, bookings, fromTime);
  if (!next) {
    return { allowed: true };
  }

  const proposedEnd = new Date(fromTime.getTime() + durationMinutes * 60000);

  // Check collision with next booking
  if (checkTimeCollision(fromTime, proposedEnd, next.start, next.end)) {
    const maxWindow = Math.max(0, Math.floor((next.start.getTime() - fromTime.getTime()) / 60000));
    const durationLabel =
      durationMinutes >= 60 ? `${durationMinutes / 60}-hour` : `${durationMinutes}-minute`;
    const bookingTimeFormatted = formatTime12h(next.booking.startTime);

    return {
      allowed: false,
      nextBooking: next.booking,
      maxAvailableMinutes: maxWindow,
      conflictBookingTimeStr: bookingTimeFormatted,
      reason: `Cannot start ${durationLabel} session. Advance booking scheduled for this station at ${bookingTimeFormatted} (Maximum available window: ${maxWindow} minutes).`,
    };
  }

  return { allowed: true };
}

/**
 * Operational Scenario 2: Booking Overlap Prevention (Form Validation)
 * Checks proposed advance booking against existing bookings & live running sessions.
 */
export function validateNewBooking(
  candidate: {
    stationId: string;
    bookingDate: string;
    startTime: string;
    durationMinutes: number;
    ignoreBookingId?: string;
  },
  existingBookings: AdvanceBooking[],
  liveSessions?: { stationId: string; startedAt: Date; allocatedMinutes: number }[]
): CollisionResult {
  const targetStation = (candidate.stationId || '').toUpperCase().trim();
  const candStart = parseBookingDateTime(candidate.bookingDate, candidate.startTime);
  const candEnd = new Date(candStart.getTime() + candidate.durationMinutes * 60000);

  // 1. Check against other confirmed advance bookings
  for (const b of existingBookings) {
    const bStatus = String(b.status || '').toUpperCase().trim();
    if (bStatus === 'CANCELLED' || bStatus === 'COMPLETED' || bStatus === 'REJECTED') continue;
    if (
      candidate.ignoreBookingId &&
      (String(b.bookingId || '').trim() === String(candidate.ignoreBookingId).trim() ||
        String(b.id || '').trim() === String(candidate.ignoreBookingId).trim())
    ) {
      continue;
    }
    if ((b.stationId || '').toUpperCase().trim() !== targetStation) continue;
    if (b.bookingDate !== candidate.bookingDate) continue;

    const bStart = parseBookingDateTime(b.bookingDate, b.startTime);
    const bEnd = parseBookingDateTime(b.bookingDate, b.endTime);

    if (checkTimeCollision(candStart, candEnd, bStart, bEnd)) {
      return {
        hasConflict: true,
        conflictingBooking: b,
        reason: `Collision detected! ${targetStation} is already booked from ${formatTime12h(
          b.startTime
        )} to ${formatTime12h(b.endTime)} for ${b.customerName}.`,
      };
    }
  }

  // 2. Check against live sessions if booking is for today
  const todayStr = toISODateString(new Date());
  if (candidate.bookingDate === todayStr && Array.isArray(liveSessions)) {
    for (const s of liveSessions) {
      if ((s.stationId || '').toUpperCase().trim() !== targetStation) continue;
      const sStart = s.startedAt;
      const sEnd = new Date(sStart.getTime() + (s.allocatedMinutes || 60) * 60000);

      // Only active live sessions running in the present/future can collide
      if (sEnd.getTime() <= Date.now()) continue;

      if (checkTimeCollision(candStart, candEnd, sStart, sEnd)) {
        return {
          hasConflict: true,
          conflictingInterval: { start: sStart, end: sEnd },
          reason: `Collision with active live session on ${targetStation} running until ${sEnd.toLocaleTimeString(
            [],
            { hour: '2-digit', minute: '2-digit' }
          )}.`,
        };
      }
    }
  }

  return { hasConflict: false };
}
