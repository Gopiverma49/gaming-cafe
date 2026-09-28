/**
 * Unified Time Collision Engine & Real-Time Next Available Slot Architecture
 * Pure, dependency-free utility functions for Vanya Gaming Lounge
 */

export interface TimeRange {
  start: Date;
  end: Date;
}

export interface ActiveSessionLike {
  id?: string;
  session_id?: string;
  station_id?: string;
  station_name?: string;
  device_name?: string;
  console_room?: string;
  started_at?: string | Date;
  startedAt?: string | Date;
  allocated_minutes?: number;
  allocatedMinutes?: number;
  status?: string;
  customer_name?: string;
  customerName?: string;
}

export interface AdvanceBookingLike {
  id?: string;
  bookingId?: string;
  stationId?: string;
  customerName?: string;
  sessionMode?: string;
  bookingDate: string;
  startTime: string;
  durationMinutes: number;
  endTime?: string;
  status?: string;
}

export interface NextAvailableSlotResult {
  status: 'IDLE_FREE' | 'IDLE_UPCOMING_BOOKING' | 'IN_SESSION_BUSY';
  displayText: string;
  nextAvailableAt: Date | null;
  freeUntil: Date | null;
}

export interface WalkInValidationResult {
  isValid: boolean;
  allowed: boolean; // Backwards-compatible alias
  conflictingBooking: AdvanceBookingLike | null;
  reason?: string;
}

export interface AdvanceBookingValidationResult {
  isValid: boolean;
  reason: string;
  conflictingSession?: ActiveSessionLike | null;
  conflictingBooking?: AdvanceBookingLike | null;
}

/**
 * 1. Unified Time Collision Engine
 * Evaluates continuous interval [StartTime, EndTime) overlap:
 * Math.max(startA, startB) < Math.min(endA, endB)
 */
export function isTimeOverlapping(
  startA: Date | number | string,
  endA: Date | number | string,
  startB: Date | number | string,
  endB: Date | number | string
): boolean {
  const sA = new Date(startA).getTime();
  const eA = new Date(endA).getTime();
  const sB = new Date(startB).getTime();
  const eB = new Date(endB).getTime();

  if (isNaN(sA) || isNaN(eA) || isNaN(sB) || isNaN(eB)) {
    return false;
  }

  return Math.max(sA, sB) < Math.min(eA, eB);
}

/**
 * Helper: Formats a Date or time string into standard 12-hour AM/PM string (e.g. 10:00 AM, 11:30 PM).
 */
export function formatTime12h(time: Date | string): string {
  if (!time) return '';
  if (time instanceof Date) {
    if (isNaN(time.getTime())) return '';
    let hours = time.getHours();
    const minutes = time.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    return `${hours}:${String(minutes).padStart(2, '0')} ${ampm}`;
  }

  const str = String(time).trim();
  if (str.includes('T')) {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      return formatTime12h(d);
    }
  }

  // Parse strings like "10:00", "14:30", "10:00 AM"
  let clean = str.toUpperCase();
  const isPM = clean.includes('PM');
  const isAM = clean.includes('AM');
  clean = clean.replace('PM', '').replace('AM', '').trim();
  const parts = clean.split(':').map((p) => parseInt(p, 10));
  if (parts.length === 0 || isNaN(parts[0])) return str;

  let h = parts[0];
  const m = parts[1] || 0;
  if (isPM && h < 12) h += 12;
  if (isAM && h === 12) h = 0;

  const ampm = h >= 12 ? 'PM' : 'AM';
  const displayH = h % 12 || 12;
  return `${displayH}:${String(m).padStart(2, '0')} ${ampm}`;
}

/**
 * Helper: Parses booking date & start time into a Date object.
 */
export function parseBookingInterval(
  bookingDate: string,
  startTime: string,
  durationMinutes: number,
  endTime?: string
): TimeRange | null {
  if (!bookingDate || !startTime) return null;
  try {
    const cleanDate = bookingDate.includes('T') ? bookingDate.split('T')[0] : bookingDate.trim();
    const dateParts = cleanDate.split('-').map(Number);
    let year = new Date().getFullYear();
    let month = 1;
    let day = 1;

    if (dateParts.length === 3) {
      if (dateParts[0] > 1000) {
        // YYYY-MM-DD
        year = dateParts[0];
        month = dateParts[1];
        day = dateParts[2];
      } else if (dateParts[2] > 1000) {
        // DD-MM-YYYY
        day = dateParts[0];
        month = dateParts[1];
        year = dateParts[2];
      }
    }

    let cleanTime = startTime.trim().toUpperCase();
    const isPM = cleanTime.includes('PM');
    const isAM = cleanTime.includes('AM');
    cleanTime = cleanTime.replace('PM', '').replace('AM', '').trim();
    const timeParts = cleanTime.split(':').map((p) => parseInt(p, 10));
    if (timeParts.length === 0 || isNaN(timeParts[0])) return null;

    let hours = timeParts[0];
    const minutes = timeParts[1] || 0;
    if (isPM && hours < 12) hours += 12;
    if (isAM && hours === 12) hours = 0;

    const start = new Date(year, month - 1, day, hours, minutes, 0, 0);
    let dur = Number(durationMinutes);
    if (!dur || isNaN(dur) || dur <= 0) {
      if (endTime) {
        const endRange = parseBookingInterval(bookingDate, endTime, 60);
        if (endRange) {
          let diff = Math.floor((endRange.start.getTime() - start.getTime()) / 60000);
          if (diff <= 0) diff += 24 * 60;
          dur = diff;
        } else {
          dur = 60;
        }
      } else {
        dur = 60;
      }
    }

    const end = new Date(start.getTime() + dur * 60000);
    return { start, end };
  } catch {
    return null;
  }
}

/**
 * 2. Real-Time Next Available Slot Architecture (for Console Station Cards)
 * 
 * - Case A (Station Idle, No Upcoming Bookings):
 *   `Available Now`
 * - Case B (Station Idle, Upcoming Advance Booking Exists):
 *   `Available Now • Free until [HH:MM AM/PM]`
 * - Case C (Station In Session / Busy):
 *   Contiguous chain calculation through chained sessions & bookings:
 *   `In Session • Next Available at [HH:MM AM/PM]`
 */
export function calculateNextAvailableSlot(
  stationId: string,
  activeSessions: ActiveSessionLike[],
  advanceBookings: AdvanceBookingLike[],
  referenceDate: Date = new Date()
): NextAvailableSlotResult {
  const normStation = (stationId || '').trim().toUpperCase();
  const refMs = referenceDate.getTime();

  // Find active session for this station (matching station_name, device_name, or station_id)
  const currentSession = (activeSessions || []).find((s) => {
    const stStatus = String(s.status || '').toUpperCase();
    if (stStatus !== 'ACTIVE') return false;
    const sName = (s.station_name || s.device_name || s.console_room || s.station_id || '').toUpperCase();
    return sName === normStation || sName.includes(normStation) || normStation.includes(sName);
  });

  // Collect and sort all valid confirmed advance bookings for this station
  const stationBookings: { booking: AdvanceBookingLike; start: Date; end: Date }[] = [];
  for (const b of advanceBookings || []) {
    const bStatus = String(b.status || '').toUpperCase();
    if (bStatus !== 'CONFIRMED') continue;

    const bStation = (b.stationId || '').toUpperCase().trim();
    if (bStation !== normStation && !bStation.includes(normStation) && !normStation.includes(bStation)) {
      continue;
    }

    const interval = parseBookingInterval(b.bookingDate, b.startTime, b.durationMinutes, b.endTime);
    if (!interval) continue;

    stationBookings.push({
      booking: b,
      start: interval.start,
      end: interval.end,
    });
  }

  // Sort chronologically by start time
  stationBookings.sort((a, b) => a.start.getTime() - b.start.getTime());

  // Check if active session is currently running
  let sessionEndTime: Date | null = null;
  if (currentSession) {
    const startedRaw = currentSession.started_at || currentSession.startedAt;
    if (startedRaw) {
      const started = new Date(startedRaw);
      const allocatedMins = currentSession.allocated_minutes || currentSession.allocatedMinutes || 60;
      const end = new Date(started.getTime() + allocatedMins * 60000);
      // If the session has not expired or was active recently
      if (end.getTime() > refMs) {
        sessionEndTime = end;
      }
    }
  }

  // Check if currently inside an advance booking window even without a live session
  const activeBookingWindow = stationBookings.find(
    (sb) => sb.start.getTime() <= refMs && sb.end.getTime() > refMs
  );

  const isStationCurrentlyBusy = !!sessionEndTime || !!activeBookingWindow;

  if (isStationCurrentlyBusy) {
    // Case C: Station In Session / Busy -> Contiguous chain calculation
    let chainEndMs = Math.max(
      sessionEndTime ? sessionEndTime.getTime() : 0,
      activeBookingWindow ? activeBookingWindow.end.getTime() : 0
    );

    // Iteratively extend chainEnd if subsequent bookings overlap or start contiguous
    let extended = true;
    while (extended) {
      extended = false;
      for (const sb of stationBookings) {
        const bStartMs = sb.start.getTime();
        const bEndMs = sb.end.getTime();

        // Contiguous chain: booking starts before or directly when current occupancy ends (within 1 min tolerance)
        // and ends after current chain end
        if (bStartMs <= chainEndMs + 60000 && bEndMs > chainEndMs) {
          chainEndMs = bEndMs;
          extended = true;
        }
      }
    }

    const nextAvailableDate = new Date(chainEndMs);
    const timeDisplay = formatTime12h(nextAvailableDate);

    return {
      status: 'IN_SESSION_BUSY',
      displayText: `In Session • Next Available at ${timeDisplay}`,
      nextAvailableAt: nextAvailableDate,
      freeUntil: null,
    };
  }

  // Station is currently IDLE. Look for upcoming confirmed bookings strictly in the future
  const upcomingBookings = stationBookings.filter((sb) => sb.start.getTime() > refMs);

  if (upcomingBookings.length > 0) {
    // Case B: Station Idle, Upcoming Advance Booking Exists
    const nextBooking = upcomingBookings[0];
    const freeUntilDate = nextBooking.start;
    const timeDisplay = formatTime12h(freeUntilDate);

    return {
      status: 'IDLE_UPCOMING_BOOKING',
      displayText: `Available Now • Free until ${timeDisplay}`,
      nextAvailableAt: null,
      freeUntil: freeUntilDate,
    };
  }

  // Case A: Station Idle, No Upcoming Bookings
  return {
    status: 'IDLE_FREE',
    displayText: 'Available Now',
    nextAvailableAt: null,
    freeUntil: null,
  };
}

/**
 * 3. Check-in Duration Collision Prevention (Walk-in check-in)
 * 
 * Let proposed walk-in window be [Now, Now + SelectedDuration].
 * If the selected duration clashes with an upcoming advance booking:
 * - Disable action button
 * - Return inline warning text:
 *   `Cannot check-in: Overlaps with an advance booking scheduled at [HH:MM AM/PM]`
 */
export function validateWalkInDuration(
  stationId: string,
  durationMinutes: number,
  advanceBookings: AdvanceBookingLike[],
  referenceDate: Date = new Date()
): WalkInValidationResult {
  const normStation = (stationId || '').trim().toUpperCase();
  const proposedStart = referenceDate;
  const proposedEnd = new Date(referenceDate.getTime() + durationMinutes * 60000);

  for (const b of advanceBookings || []) {
    const bStatus = String(b.status || '').toUpperCase();
    if (bStatus !== 'CONFIRMED') continue;

    const bStation = (b.stationId || '').toUpperCase().trim();
    if (bStation !== normStation && !bStation.includes(normStation) && !normStation.includes(bStation)) {
      continue;
    }

    const interval = parseBookingInterval(b.bookingDate, b.startTime, b.durationMinutes, b.endTime);
    if (!interval) continue;

    if (isTimeOverlapping(proposedStart, proposedEnd, interval.start, interval.end)) {
      const scheduledTimeStr = formatTime12h(interval.start);
      return {
        isValid: false,
        allowed: false,
        conflictingBooking: b,
        reason: `Cannot check-in: Overlaps with an advance booking scheduled at ${scheduledTimeStr}`,
      };
    }
  }

  return {
    isValid: true,
    allowed: true,
    conflictingBooking: null,
  };
}

/**
 * 4. Advance Booking Bar Validation (Advance Bookings Tab)
 * 
 * - Validates [BookingStart, BookingStart + Duration] against:
 *   1. Live Sessions on that station (flag collision if session.EndTime > BookingStart and overlaps)
 *   2. Existing non-cancelled Advance Bookings on that station
 * 
 * - Visual Feedback reasons:
 *   Collision with Live Session: `Collision Detected: Station [Name] is occupied until [HH:MM AM/PM]`
 *   Collision with Existing Booking: `Collision Detected: Overlaps with an existing reservation ([HH:MM] - [HH:MM])`
 *   Valid: `Slot Accepted & Available ([Station]: [Start] - [End])`
 */
export function validateAdvanceBooking(
  stationId: string,
  startTime: Date | string,
  durationMinutes: number,
  activeSessions: ActiveSessionLike[],
  advanceBookings: AdvanceBookingLike[],
  options?: {
    bookingDate?: string;
    ignoreBookingId?: string;
  }
): AdvanceBookingValidationResult {
  const normStation = (stationId || '').trim().toUpperCase();

  // Resolve candidate interval [candStart, candEnd]
  let candStart: Date | null = null;
  if (startTime instanceof Date) {
    candStart = startTime;
  } else if (typeof startTime === 'string') {
    if (startTime.includes('T')) {
      candStart = new Date(startTime);
    } else if (options?.bookingDate) {
      const parsed = parseBookingInterval(options.bookingDate, startTime, durationMinutes);
      if (parsed) {
        candStart = parsed.start;
      }
    } else {
      candStart = new Date(startTime);
    }
  }

  if (!candStart || isNaN(candStart.getTime())) {
    return {
      isValid: false,
      reason: 'Please select a valid date and start time.',
      conflictingSession: null,
      conflictingBooking: null,
    };
  }

  const candEnd = new Date(candStart.getTime() + durationMinutes * 60000);
  const now = new Date();

  // 1. Validate against Live Sessions
  for (const s of activeSessions || []) {
    const stStatus = String(s.status || '').toUpperCase();
    if (stStatus !== 'ACTIVE') continue;

    const sStation = (s.station_name || s.device_name || s.console_room || s.station_id || '').toUpperCase();
    if (sStation !== normStation && !sStation.includes(normStation) && !normStation.includes(sStation)) {
      continue;
    }

    const startedRaw = s.started_at || s.startedAt;
    if (!startedRaw) continue;

    const sStart = new Date(startedRaw);
    const allocated = s.allocated_minutes || s.allocatedMinutes || 60;
    const sEnd = new Date(sStart.getTime() + allocated * 60000);

    // Only active sessions running in the present/future can collide
    if (sEnd.getTime() <= now.getTime()) continue;

    // Condition: sEnd > candStart and overlaps with [candStart, candEnd]
    if (isTimeOverlapping(candStart, candEnd, sStart, sEnd)) {
      const occupiedUntilStr = formatTime12h(sEnd);
      return {
        isValid: false,
        conflictingSession: s,
        conflictingBooking: null,
        reason: `Collision Detected: Station ${normStation} is occupied until ${occupiedUntilStr}`,
      };
    }
  }

  // 2. Validate against Existing Advance Bookings
  for (const b of advanceBookings || []) {
    const bStatus = String(b.status || '').toUpperCase();
    if (bStatus === 'CANCELLED' || bStatus === 'COMPLETED' || bStatus === 'REJECTED') {
      continue;
    }

    if (
      options?.ignoreBookingId &&
      (String(b.bookingId || '').trim() === String(options.ignoreBookingId).trim() ||
        String(b.id || '').trim() === String(options.ignoreBookingId).trim())
    ) {
      continue;
    }

    const bStation = (b.stationId || '').toUpperCase().trim();
    if (bStation !== normStation && !bStation.includes(normStation) && !normStation.includes(bStation)) {
      continue;
    }

    const interval = parseBookingInterval(b.bookingDate, b.startTime, b.durationMinutes, b.endTime);
    if (!interval) continue;

    if (isTimeOverlapping(candStart, candEnd, interval.start, interval.end)) {
      const resStartStr = formatTime12h(interval.start);
      const resEndStr = formatTime12h(interval.end);
      return {
        isValid: false,
        conflictingSession: null,
        conflictingBooking: b,
        reason: `Collision Detected: Overlaps with an existing reservation (${resStartStr} - ${resEndStr})`,
      };
    }
  }

  // Valid slot accepted
  const candStartStr = formatTime12h(candStart);
  const candEndStr = formatTime12h(candEnd);

  return {
    isValid: true,
    conflictingSession: null,
    conflictingBooking: null,
    reason: `Slot Accepted & Available (${normStation}: ${candStartStr} - ${candEndStr})`,
  };
}
