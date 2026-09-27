import React, { useState, useMemo, useEffect } from 'react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import {
  CalendarClock,
  Search,
  CheckCircle2,
  AlertTriangle,
  Play,
  Edit2,
  XCircle,
  Clock,
  Gamepad2,
  Phone,
  User,
} from 'lucide-react';
import { useLoungeStore, AdvanceBooking } from '../store/loungeStore';
import { useNotificationStore } from '../store/notificationStore';
import { POLL_INTERVALS } from '../constants';
import {
  calculateEndTime,
  calculateFareForMode,
  getAdminConfiguredFare,
  formatTime12h,
  toISODateString,
  validateNewBooking,
  parseBookingDateTime,
} from '../utils/bookingConflict';
import {
  startCategorySessionApi,
  fetchStationMatrix,
  createAdvanceBookingApi,
  cancelAdvanceBookingApi,
  fetchAdvanceBookingsApi,
} from '../api';
import { StationMatrixData } from '../types';

interface AdvanceBookingsManagerProps {
  onSessionStarted?: () => void;
}

export const AdvanceBookingsManager: React.FC<AdvanceBookingsManagerProps> = ({
  onSessionStarted,
}) => {
  const queryClient = useQueryClient();
  const { bookings, addBooking, updateBooking, cancelBooking, activateBooking } = useLoungeStore();
  const { addNotification } = useNotificationStore();

  // Fetch live stations matrix to know live stations & active sessions for collision checks
  const { data: matrixData = { modes: [], stations: [] } } = useQuery<StationMatrixData>({
    queryKey: ['station-matrix'],
    queryFn: fetchStationMatrix,
    refetchInterval: POLL_INTERVALS.STATIONS,
  });

  // Query server for advance bookings with fast reactive polling
  const { data: serverBookings = [] } = useQuery<any[]>({
    queryKey: ['advance-bookings'],
    queryFn: fetchAdvanceBookingsApi,
    refetchInterval: 2000,
  });

  useEffect(() => {
    if (Array.isArray(serverBookings) && serverBookings.length > 0) {
      const current = useLoungeStore.getState().bookings;
      const map = new Map<string, any>();
      current.forEach((b) => map.set(String(b.bookingId || b.id), b));
      serverBookings.forEach((sb) => map.set(String(sb.bookingId || sb.id), sb));
      useLoungeStore.setState({ bookings: Array.from(map.values()) });
    }
  }, [serverBookings]);

  const availableStations = useMemo(() => {
    if (Array.isArray(matrixData.stations) && matrixData.stations.length > 0) {
      return matrixData.stations.map((s) => s.name);
    }
    return ['PS1', 'PS2', 'PS3'];
  }, [matrixData.stations]);

  // Extract ongoing live sessions for collision check
  const liveSessions = useMemo(() => {
    const list: { stationId: string; startedAt: Date; allocatedMinutes: number }[] = [];
    if (Array.isArray(matrixData.stations)) {
      for (const s of matrixData.stations) {
        if (s.active_session && s.active_session.started_at) {
          list.push({
            stationId: s.name || s.id,
            startedAt: new Date(s.active_session.started_at),
            allocatedMinutes: s.active_session.allocated_minutes || 60,
          });
        }
      }
    }
    return list;
  }, [matrixData.stations]);

  // =========================================================================
  // SINGLE-ROW QUICK BOOKING FORM STATE
  // =========================================================================
  const todayStr = useMemo(() => toISODateString(new Date()), []);
  const defaultStartTime = useMemo(() => {
    const now = new Date();
    // Round to next 30 or 60 minute interval
    const m = now.getMinutes();
    const nextH = m > 30 ? (now.getHours() + 1) % 24 : now.getHours();
    const nextM = m > 30 ? '00' : '30';
    return `${String(nextH).padStart(2, '0')}:${nextM}`;
  }, []);

  const [customerName, setCustomerName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [stationId, setStationId] = useState(availableStations[0] || 'PS1');
  const [sessionMode, setSessionMode] = useState<'Solo' | 'Multiplayer'>('Solo');
  // Date & Start in ONE single unified datetime-local input
  const [startDateTime, setStartDateTime] = useState(`${todayStr}T${defaultStartTime}`);

  const bookingDate = useMemo(() => {
    return startDateTime.includes('T') ? startDateTime.split('T')[0] : todayStr;
  }, [startDateTime, todayStr]);

  const startTime = useMemo(() => {
    return startDateTime.includes('T') ? startDateTime.split('T')[1].slice(0, 5) : defaultStartTime;
  }, [startDateTime, defaultStartTime]);

  const [durationMinutes, setDurationMinutes] = useState(60);
  const [advancePaid, setAdvancePaid] = useState<number>(100);

  // Dynamically calculated end time
  const calculatedEndTime = useMemo(
    () => calculateEndTime(startTime, durationMinutes),
    [startTime, durationMinutes]
  );

  // Dynamically calculated total fare synced with what the admin configured
  const calculatedTotalAmount = useMemo(
    () => getAdminConfiguredFare(stationId, sessionMode, durationMinutes, matrixData),
    [stationId, sessionMode, durationMinutes, matrixData]
  );

  // Dynamically calculated remaining balance
  const remainingBalance = Math.max(0, calculatedTotalAmount - (advancePaid || 0));

  // Dynamic Collision Prevention Check in Real-Time
  const collisionCheck = useMemo(() => {
    if (!startTime || !bookingDate) return { hasConflict: false };
    return validateNewBooking(
      {
        stationId,
        bookingDate,
        startTime,
        durationMinutes,
      },
      bookings,
      liveSessions
    );
  }, [stationId, bookingDate, startTime, durationMinutes, bookings, liveSessions]);

  // Handle Quick Booking Submit
  const handleConfirmBooking = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName.trim()) {
      addNotification('SYSTEM', '⚠️ Required Field', 'Customer Name is mandatory for advance booking.');
      return;
    }

    // Direct synchronous collision validation
    const freshCheck = validateNewBooking(
      {
        stationId,
        bookingDate,
        startTime,
        durationMinutes,
      },
      bookings,
      liveSessions
    );

    if (freshCheck.hasConflict) {
      addNotification('SYSTEM', '🚫 Collision Detected', freshCheck.reason || 'This slot overlaps with an existing booking or live session.');
      return; // HARD STOP: Never create booking when there is a collision
    }

    const newBooking = addBooking({
      customerName: customerName.trim(),
      phoneNumber: phoneNumber.trim() || undefined,
      stationId,
      sessionMode,
      bookingDate,
      startTime,
      durationMinutes,
      endTime: calculatedEndTime,
      advancePaid: Number(advancePaid) || 0,
      totalAmount: calculatedTotalAmount,
      remainingBalance,
      status: 'CONFIRMED',
    });

    createAdvanceBookingApi(newBooking).catch(() => {});
    queryClient.invalidateQueries({ queryKey: ['advance-bookings'] });

    addNotification(
      'SYSTEM',
      '📅 Booking Confirmed',
      `Advance booking ${newBooking.bookingId} confirmed for ${newBooking.customerName} on ${newBooking.stationId} at ${formatTime12h(newBooking.startTime)}.`
    );

    // Reset quick booking inputs to next ready state
    setCustomerName('');
    setPhoneNumber('');
    setAdvancePaid(100);
  };

  // =========================================================================
  // SCHEDULE TABLE FILTERS & SEARCH
  // =========================================================================
  const [filterStation, setFilterStation] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Edit Modal State
  const [editingBooking, setEditingBooking] = useState<AdvanceBooking | null>(null);
  const [editCustomerName, setEditCustomerName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editStationId, setEditStationId] = useState('');
  const [editMode, setEditMode] = useState<'Solo' | 'Multiplayer'>('Solo');
  const [editDate, setEditDate] = useState('');
  const [editStartTime, setEditStartTime] = useState('');
  const [editDuration, setEditDuration] = useState(60);
  const [editAdvance, setEditAdvance] = useState(0);

  const openEditModal = (b: AdvanceBooking) => {
    setEditingBooking(b);
    setEditCustomerName(b.customerName);
    setEditPhone(b.phoneNumber || '');
    setEditStationId(b.stationId);
    setEditMode((b.sessionMode as any) || 'Solo');
    setEditDate(b.bookingDate);
    setEditStartTime(b.startTime);
    setEditDuration(b.durationMinutes);
    setEditAdvance(b.advancePaid);
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBooking) return;

    const newEnd = calculateEndTime(editStartTime, editDuration);
    const newTotal = getAdminConfiguredFare(editStationId, editMode, editDuration, matrixData);

    // Check collision excluding self
    const editCollision = validateNewBooking(
      {
        stationId: editStationId,
        bookingDate: editDate,
        startTime: editStartTime,
        durationMinutes: editDuration,
        ignoreBookingId: editingBooking.bookingId,
      },
      bookings,
      liveSessions
    );

    if (editCollision.hasConflict) {
      addNotification('SYSTEM', '⚠️ Schedule Conflict', editCollision.reason || 'Collision with existing slot.');
      return;
    }

    updateBooking(editingBooking.bookingId, {
      customerName: editCustomerName.trim(),
      phoneNumber: editPhone.trim() || undefined,
      stationId: editStationId,
      sessionMode: editMode,
      bookingDate: editDate,
      startTime: editStartTime,
      durationMinutes: editDuration,
      endTime: newEnd,
      advancePaid: Number(editAdvance) || 0,
      totalAmount: newTotal,
    });

    addNotification('SYSTEM', '✏️ Booking Updated', `Booking ${editingBooking.bookingId} modified successfully.`);
    setEditingBooking(null);
  };

  // Check-In / Start Live Session from Booking
  const [startingBookingId, setStartingBookingId] = useState<string | null>(null);

  const handleCheckInAndStart = async (b: AdvanceBooking) => {
    // Check if station is occupied right now
    const isOccupied = liveSessions.some((s) => s.stationId.toUpperCase() === b.stationId.toUpperCase());
    if (isOccupied) {
      addNotification(
        'SYSTEM',
        '⚠️ Station Occupied',
        `${b.stationId} currently has an ongoing live session. Settle or transfer the current session first.`
      );
      return;
    }

    setStartingBookingId(b.bookingId);
    try {
      await startCategorySessionApi({
        station_id: b.stationId,
        mode: b.sessionMode,
        category_id: b.sessionMode.toLowerCase(),
        device_id: b.stationId,
        duration_minutes: b.durationMinutes,
        customer_name: b.customerName,
        customer_phone: b.phoneNumber,
      });

      activateBooking(b.bookingId);
      // Force immediate synchronous refetch across all queries for autoreflect
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['station-matrix'] }),
        queryClient.refetchQueries({ queryKey: ['stations-live'] }),
        queryClient.refetchQueries({ queryKey: ['customer-sessions'] }),
      ]);

      addNotification(
        'SYSTEM',
        '🎮 Booking Checked-In',
        `Live session launched for ${b.customerName} on ${b.stationId} (${b.durationMinutes}m).`
      );
      if (onSessionStarted) {
        onSessionStarted();
      }
    } catch (err: any) {
      addNotification('SYSTEM', '⚠️ Check-in Failed', err.message || 'Could not launch session.');
    } finally {
      setStartingBookingId(null);
    }
  };

  // Filtered Bookings List (Latest check-ins and bookings at top)
  const sortedBookings = useMemo(() => {
    return [...bookings].sort((a, b) => {
      const dateA = parseBookingDateTime(a.bookingDate, a.startTime).getTime();
      const dateB = parseBookingDateTime(b.bookingDate, b.startTime).getTime();
      if (dateB !== dateA) return dateB - dateA;
      const createdA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const createdB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return createdB - createdA;
    });
  }, [bookings]);

  const filteredBookings = useMemo(() => {
    return sortedBookings.filter((b) => {
      // Station filter
      if (filterStation !== 'ALL' && b.stationId.toUpperCase() !== filterStation.toUpperCase()) return false;

      // Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const name = (b.customerName || '').toLowerCase();
        const phone = (b.phoneNumber || '').toLowerCase();
        const st = (b.stationId || '').toLowerCase();
        return name.includes(q) || phone.includes(q) || st.includes(q);
      }

      return true;
    });
  }, [sortedBookings, filterStation, searchQuery]);

  return (
    <div className="space-y-4">
      {/* ========================================================================= */}
      {/* 1. SINGLE-ROW COMPACT QUICK BOOKING BAR */}
      {/* ========================================================================= */}
      <div className="bg-[#FFFFFF] p-4 sm:p-5 rounded-2xl border border-[#E2E8F0] shadow-xs space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-[#F1F5F9]">
          <h3 className="text-xs sm:text-sm font-bold text-[#0F172A] font-display flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#EA580C] animate-pulse"></span>
            <span>Advance Booking Bar</span>
            <span className="text-[10px] font-mono-code text-[#64748B] font-normal">
              (Live Dynamic Collision Check)
            </span>
          </h3>

          {/* Real-time Acceptance Notification Badge */}
          {!collisionCheck.hasConflict ? (
            <div className="flex items-center gap-1.5 text-xs text-[#15803D] font-bold bg-[#F0FDF4] px-3 py-1 rounded-xl border border-[#86EFAC] shadow-2xs animate-in fade-in duration-150">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#16A34A]" />
              <span>Slot Accepted &amp; Available ({stationId}: {formatTime12h(startTime)} - {formatTime12h(calculatedEndTime)})</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-[#B91C1C] font-bold bg-[#FEF2F2] px-3 py-1 rounded-xl border border-[#FECACA] shadow-2xs animate-in fade-in duration-150">
              <AlertTriangle className="w-3.5 h-3.5 text-[#DC2626] shrink-0" />
              <span>🚫 Slot Occupied ({stationId} Collision)</span>
            </div>
          )}
        </div>

        {/* The Single-Row Horizontal Grid Form */}
        <form onSubmit={handleConfirmBooking} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-12 gap-2.5 items-end">
            {/* 1. Customer Name (decreased width, 2 cols of 12) */}
            <div className="lg:col-span-2 space-y-1">
              <label className="text-[10px] uppercase font-bold text-[#64748B] flex items-center gap-1">
                <User className="w-3 h-3 text-[#EA580C]" /> Name *
              </label>
              <input
                type="text"
                required
                placeholder="Customer Name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="w-full px-2.5 py-2 rounded-xl bg-[#FFF7ED]/30 border border-[#E2E8F0] text-xs font-semibold text-[#0F172A] placeholder-[#94A3B8] focus:outline-none focus:border-[#EA580C] shadow-2xs"
              />
            </div>

            {/* 2. Phone Number (1 col) */}
            <div className="lg:col-span-1 space-y-1">
              <label className="text-[10px] uppercase font-bold text-[#64748B] flex items-center gap-1">
                <Phone className="w-3 h-3 text-[#64748B]" /> Phone
              </label>
              <input
                type="tel"
                placeholder="10 Digits"
                maxLength={10}
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, '').slice(0, 10))}
                className="w-full px-2 py-2 rounded-xl bg-[#FFFFFF] border border-[#E2E8F0] text-xs font-mono-code text-[#0F172A] placeholder-[#94A3B8] focus:outline-none focus:border-[#EA580C] shadow-2xs"
              />
            </div>

            {/* 3. Console Station (1 col) */}
            <div className="lg:col-span-1 space-y-1">
              <label className="text-[10px] uppercase font-bold text-[#64748B] flex items-center gap-1">
                <Gamepad2 className="w-3 h-3 text-[#64748B]" /> Station
              </label>
              <select
                value={stationId}
                onChange={(e) => setStationId(e.target.value)}
                className="w-full px-2 py-2 rounded-xl bg-[#FFFFFF] border border-[#E2E8F0] text-xs font-bold text-[#172554] focus:outline-none focus:border-[#EA580C] shadow-2xs cursor-pointer"
              >
                {availableStations.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>

            {/* 4. Mode (Solo / Multiplayer) (1 col) */}
            <div className="lg:col-span-1 space-y-1">
              <label className="text-[10px] uppercase font-bold text-[#64748B]">Mode</label>
              <div className="inline-flex w-full p-0.5 bg-[#F1F5F9] rounded-xl border border-[#E2E8F0]">
                <button
                  type="button"
                  onClick={() => setSessionMode('Solo')}
                  className={`flex-1 py-1.5 text-[10px] font-bold rounded-lg transition-all cursor-pointer ${
                    sessionMode === 'Solo'
                      ? 'bg-[#172554] text-white shadow-2xs'
                      : 'text-[#64748B] hover:text-[#0F172A]'
                  }`}
                >
                  Solo
                </button>
                <button
                  type="button"
                  onClick={() => setSessionMode('Multiplayer')}
                  className={`flex-1 py-1.5 text-[10px] font-bold rounded-lg transition-all cursor-pointer ${
                    sessionMode === 'Multiplayer'
                      ? 'bg-[#EA580C] text-white shadow-2xs'
                      : 'text-[#64748B] hover:text-[#0F172A]'
                  }`}
                >
                  Multi
                </button>
              </div>
            </div>

            {/* 5. Date & Start Time in ONE SINGLE BOX (2 cols) */}
            <div className="lg:col-span-2 space-y-1">
              <label className="text-[10px] uppercase font-bold text-[#64748B] flex items-center gap-1">
                <Clock className="w-3 h-3 text-[#64748B]" /> Date &amp; Start Time
              </label>
              <input
                type="datetime-local"
                value={startDateTime}
                min={`${todayStr}T00:00`}
                onChange={(e) => setStartDateTime(e.target.value)}
                className="w-full px-2 py-2 rounded-xl bg-[#FFFFFF] border border-[#E2E8F0] text-xs font-mono-code font-bold text-[#172554] focus:outline-none focus:border-[#EA580C] shadow-2xs"
              />
            </div>

            {/* 6. Duration Pills (2 cols) - 30m, 1h, 2h (no custom) */}
            <div className="lg:col-span-2 space-y-1">
              <label className="text-[10px] uppercase font-bold text-[#64748B]">Duration</label>
              <div className="grid grid-cols-3 gap-1">
                {[30, 60, 120].map((mins) => {
                  const isSelected = durationMinutes === mins;
                  return (
                    <button
                      key={mins}
                      type="button"
                      onClick={() => setDurationMinutes(mins)}
                      className={`py-1.5 rounded-xl text-[11px] font-bold transition-all border cursor-pointer ${
                        isSelected
                          ? 'bg-[#172554] border-[#172554] text-white shadow-2xs'
                          : 'bg-[#FFFFFF] border-[#E2E8F0] text-[#64748B] hover:text-[#0F172A]'
                      }`}
                    >
                      {mins === 30 ? '30m' : mins === 60 ? '1h' : '2h'}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 7. Total Fare (Read-only dynamic synced with admin prices) (1 col) */}
            <div className="lg:col-span-1 space-y-1">
              <label className="text-[10px] uppercase font-bold text-[#64748B]">Total</label>
              <div className="px-2 py-2 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-xs font-black text-[#172554] font-mono-code text-center shadow-2xs">
                ₹{calculatedTotalAmount.toFixed(0)}
              </div>
            </div>

            {/* 8. Advance Paid (Numeric Input) (1 col) */}
            <div className="lg:col-span-1 space-y-1">
              <label className="text-[10px] uppercase font-bold text-[#15803D]">Advance</label>
              <div className="relative">
                <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-xs font-bold text-[#15803D]">₹</span>
                <input
                  type="number"
                  min={0}
                  max={calculatedTotalAmount}
                  value={advancePaid}
                  onChange={(e) => setAdvancePaid(Number(e.target.value) || 0)}
                  className="w-full pl-5 pr-1 py-2 rounded-xl bg-[#F0FDF4] border border-[#BBF7D0] text-xs font-bold text-[#15803D] font-mono-code focus:outline-none focus:border-[#16A34A] shadow-2xs text-center"
                />
              </div>
            </div>

            {/* 9. Balance Due & 10. [ Confirm Booking ] Button (1 col) */}
            <div className="lg:col-span-1 space-y-1">
              <div className="flex items-center justify-between text-[10px] uppercase font-bold text-[#64748B]">
                <span>Bal</span>
                <span className="text-[#EA580C] font-mono-code font-black">₹{remainingBalance.toFixed(0)}</span>
              </div>
              <button
                type="submit"
                disabled={collisionCheck.hasConflict || !customerName.trim()}
                className="w-full py-2 px-2 rounded-xl font-bold font-display text-xs tracking-wider transition-all flex items-center justify-center gap-1 shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed bg-[#16A34A] hover:bg-[#15803D] text-white"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Confirm</span>
              </button>
            </div>
          </div>

          {/* Collision Warning Banner if conflict exists */}
          {collisionCheck.hasConflict && (
            <div className="p-3 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-[#B91C1C] text-xs flex items-center gap-2 animate-in fade-in">
              <AlertTriangle className="w-4 h-4 text-[#B91C1C] shrink-0" />
              <div className="flex-1 font-semibold">
                {collisionCheck.reason || 'This station is already booked or running during this time.'}
              </div>
              <span className="text-[10px] uppercase font-mono-code font-bold bg-white px-2 py-0.5 rounded border border-[#FECACA]">
                Booking Blocked
              </span>
            </div>
          )}
        </form>
      </div>

      {/* ========================================================================= */}
      {/* 2. ADVANCE BOOKING SCHEDULE TABLE */}
      {/* ========================================================================= */}
      <div className="bg-[#FFFFFF] p-5 rounded-2xl border border-[#E2E8F0] shadow-xs space-y-4">
        {/* Table Filter: Station and Search Bar (Status and Period dropdowns removed per request) */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-[#F1F5F9]">
          <div className="flex items-center gap-2.5">
            <h4 className="text-sm font-bold text-[#172554] font-display flex items-center gap-1.5">
              <CalendarClock className="w-4 h-4 text-[#EA580C]" />
              <span>Bookings Schedule</span>
              <span className="text-xs font-mono-code text-[#64748B]">({filteredBookings.length})</span>
            </h4>

            {/* Station Dropdown Filter */}
            <select
              value={filterStation}
              onChange={(e) => setFilterStation(e.target.value)}
              className="px-3 py-1.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-xs font-semibold text-[#172554] focus:outline-none cursor-pointer"
            >
              <option value="ALL">All Stations</option>
              {availableStations.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>

          {/* Search box */}
          <div className="relative min-w-[220px]">
            <Search className="w-3.5 h-3.5 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search customer, phone, station..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-xs text-[#0F172A] placeholder-[#94A3B8] focus:outline-none focus:border-[#EA580C]"
            />
          </div>
        </div>

        {/* Schedule Table */}
        <div className="overflow-x-auto rounded-xl border border-[#E2E8F0]">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#F8FAFC] text-[#64748B] font-mono-code uppercase text-[10px] border-b border-[#E2E8F0]">
                <th className="py-3 px-4 font-bold">Station</th>
                <th className="py-3 px-4 font-bold">Mode</th>
                <th className="py-3 px-4 font-bold">Customer</th>
                <th className="py-3 px-4 font-bold">Time Window</th>
                <th className="py-3 px-4 font-bold text-right">Advance Paid</th>
                <th className="py-3 px-4 font-bold text-right">Balance Due</th>
                <th className="py-3 px-4 font-bold text-center">Status</th>
                <th className="py-3 px-4 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0] font-sans">
              {filteredBookings.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-[#64748B] space-y-2">
                    <CalendarClock className="w-8 h-8 text-[#CBD5E1] mx-auto" />
                    <p className="font-semibold text-sm text-[#0F172A]">No advance bookings found</p>
                    <p className="text-xs text-[#94A3B8]">
                      Use the Quick Booking Bar above to schedule upcoming console sessions.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredBookings.map((b) => {
                  const isToday = b.bookingDate === todayStr;
                  const isConfirmed = b.status === 'CONFIRMED';
                  const isActive = b.status === 'ACTIVE';
                  const isStarting = startingBookingId === b.bookingId;

                  return (
                    <tr
                      key={b.bookingId}
                      className={`hover:bg-[#F8FAFC] transition-colors font-medium text-[#0F172A] ${
                        isActive ? 'bg-[#F0FDF4]/30' : ''
                      }`}
                    >
                      {/* Station */}
                      <td className="py-3 px-4">
                        <span className="font-mono-code font-bold px-2.5 py-1 rounded-lg bg-[#EFF6FF] text-[#1E40AF] border border-[#BFDBFE]">
                          {b.stationId}
                        </span>
                      </td>

                      {/* Mode */}
                      <td className="py-3 px-4">
                        <span
                          className={`font-semibold px-2 py-0.5 rounded-md text-[11px] ${
                            b.sessionMode === 'Solo'
                              ? 'bg-[#F1F5F9] text-[#172554]'
                              : 'bg-[#FFF7ED] text-[#EA580C] border border-[#FED7AA]'
                          }`}
                        >
                          {b.sessionMode}
                        </span>
                      </td>

                      {/* Customer */}
                      <td className="py-3 px-4">
                        <div>
                          <div className="font-bold text-[#0F172A]">{b.customerName}</div>
                          {b.phoneNumber && (
                            <div className="text-[11px] text-[#64748B] font-mono-code flex items-center gap-1">
                              <span>📞</span>
                              <span>{b.phoneNumber}</span>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Time Window */}
                      <td className="py-3 px-4">
                        <div className="font-mono-code">
                          <div className="font-bold text-[#172554] flex items-center gap-1.5">
                            <span>{formatTime12h(b.startTime)} - {formatTime12h(b.endTime)}</span>
                            <span className="text-[10px] text-[#64748B] font-normal font-sans">({b.durationMinutes}m)</span>
                          </div>
                          <div className="text-[11px] text-[#64748B] font-sans">
                            {isToday ? (
                              <span className="text-[#EA580C] font-semibold">Today</span>
                            ) : (
                              new Date(b.bookingDate).toLocaleDateString([], { month: 'short', day: 'numeric', weekday: 'short' })
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Advance Paid */}
                      <td className="py-3 px-4 text-right font-mono-code">
                        <span className="px-2 py-0.5 rounded-lg bg-[#F0FDF4] text-[#15803D] font-bold border border-[#BBF7D0]">
                          ₹{Number(b.advancePaid || 0).toFixed(2)}
                        </span>
                      </td>

                      {/* Balance Due */}
                      <td className="py-3 px-4 text-right font-mono-code">
                        <span
                          className={`font-bold ${
                            b.remainingBalance > 0 ? 'text-[#EA580C]' : 'text-[#64748B]'
                          }`}
                        >
                          ₹{Number(b.remainingBalance || 0).toFixed(2)}
                        </span>
                        <div className="text-[10px] text-[#94A3B8]">Total: ₹{b.totalAmount}</div>
                      </td>

                      {/* Status */}
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                            b.status === 'CONFIRMED'
                              ? 'bg-[#EFF6FF] text-[#1D4ED8] border border-[#BFDBFE]'
                              : b.status === 'ACTIVE'
                              ? 'bg-[#DCFCE7] text-[#15803D] border border-[#BBF7D0] animate-pulse'
                              : b.status === 'COMPLETED'
                              ? 'bg-[#F1F5F9] text-[#64748B]'
                              : 'bg-[#FEF2F2] text-[#B91C1C] border border-[#FECACA]'
                          }`}
                        >
                          ● {b.status}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right space-x-1.5">
                        {isConfirmed && (
                          <button
                            type="button"
                            disabled={isStarting}
                            onClick={() => handleCheckInAndStart(b)}
                            title="Start live session immediately for this booking"
                            className="px-2.5 py-1 rounded-lg bg-[#16A34A] hover:bg-[#15803D] text-white font-bold text-[11px] inline-flex items-center gap-1 transition-all cursor-pointer shadow-2xs disabled:opacity-50"
                          >
                            <Play className="w-3 h-3 fill-current" />
                            <span>{isStarting ? 'Starting...' : 'Check-In'}</span>
                          </button>
                        )}

                        {isConfirmed && (
                          <button
                            type="button"
                            onClick={() => openEditModal(b)}
                            title="Edit booking"
                            className="p-1 rounded-lg text-[#64748B] hover:text-[#0F172A] hover:bg-[#F1F5F9] transition-all cursor-pointer"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {isConfirmed && (
                          <button
                            type="button"
                            onClick={() => {
                              if (confirm(`Are you sure you want to cancel booking for ${b.customerName}?`)) {
                                const targetId = String(b.bookingId || b.id || '');
                                if (targetId) {
                                  cancelBooking(targetId);
                                  cancelAdvanceBookingApi(targetId).catch(() => {});
                                  queryClient.invalidateQueries({ queryKey: ['advance-bookings'] });
                                  queryClient.invalidateQueries({ queryKey: ['station-matrix'] });
                                  queryClient.invalidateQueries({ queryKey: ['stations-live'] });
                                  queryClient.invalidateQueries({ queryKey: ['customer-sessions'] });
                                  addNotification('SYSTEM', '🗑️ Booking Cancelled', `Booking for ${b.customerName} has been cancelled.`);
                                }
                              }
                            }}
                            title="Cancel booking"
                            className="p-1 rounded-lg text-[#EF4444] hover:text-[#DC2626] hover:bg-[#FEF2F2] transition-all cursor-pointer"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 4. EDIT BOOKING MODAL */}
      {/* ========================================================================= */}
      {editingBooking && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#FFFFFF] max-w-lg w-full rounded-2xl p-5 sm:p-6 border border-[#E2E8F0] shadow-2xl relative space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-2 border-b border-[#E2E8F0]">
              <h3 className="text-base font-bold text-[#172554] font-display flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-[#EA580C]" />
                <span>Edit Booking ({editingBooking.bookingId})</span>
              </h3>
              <button
                onClick={() => setEditingBooking(null)}
                className="text-[#64748B] hover:text-[#0F172A] cursor-pointer"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-[#64748B] uppercase">Customer Name</label>
                  <input
                    type="text"
                    required
                    value={editCustomerName}
                    onChange={(e) => setEditCustomerName(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] font-semibold text-[#0F172A]"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-[#64748B] uppercase">Phone Number</label>
                  <input
                    type="tel"
                    maxLength={10}
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    className="w-full px-3 py-2 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] font-mono-code text-[#0F172A]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-[#64748B] uppercase">Station</label>
                  <select
                    value={editStationId}
                    onChange={(e) => setEditStationId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] font-bold text-[#172554]"
                  >
                    {availableStations.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-[#64748B] uppercase">Mode</label>
                  <select
                    value={editMode}
                    onChange={(e) => setEditMode(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] font-semibold text-[#0F172A]"
                  >
                    <option value="Solo">Solo</option>
                    <option value="Multiplayer">Multiplayer</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-[#64748B] uppercase">Date</label>
                  <input
                    type="date"
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    className="w-full px-2 py-2 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] font-mono-code text-[11px]"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-[#64748B] uppercase">Start Time</label>
                  <input
                    type="time"
                    value={editStartTime}
                    onChange={(e) => setEditStartTime(e.target.value)}
                    className="w-full px-2 py-2 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] font-mono-code font-bold text-[11px]"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-[#64748B] uppercase">Duration</label>
                  <select
                    value={editDuration}
                    onChange={(e) => setEditDuration(Number(e.target.value))}
                    className="w-full px-2 py-2 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] font-semibold text-[11px]"
                  >
                    <option value={30}>30 mins</option>
                    <option value={60}>1 hour</option>
                    <option value={120}>2 hours</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1 border-t border-[#E2E8F0]">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-[#15803D] uppercase">Advance Paid (₹)</label>
                  <input
                    type="number"
                    min={0}
                    value={editAdvance}
                    onChange={(e) => setEditAdvance(Number(e.target.value) || 0)}
                    className="w-full px-3 py-2 rounded-xl bg-[#F0FDF4] border border-[#BBF7D0] font-mono-code font-bold text-[#15803D]"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-[#64748B] uppercase">Total Calculated Fare</label>
                  <div className="px-3 py-2 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] font-mono-code font-bold text-[#172554]">
                    ₹{calculateFareForMode(editMode, editDuration)}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E2E8F0]">
                <button
                  type="button"
                  onClick={() => setEditingBooking(null)}
                  className="px-4 py-2 rounded-xl border border-[#E2E8F0] text-[#64748B] font-semibold hover:text-[#0F172A] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-[#172554] text-white font-bold hover:bg-[#1E3A8A] cursor-pointer"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
