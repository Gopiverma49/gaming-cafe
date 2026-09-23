import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Gamepad2,
  Users,
  Sparkles,
  Cpu,
  Timer,
  UtensilsCrossed,
  Receipt,
  ArrowRightLeft,
  PlusCircle,
  Play,
  CheckCircle2,
  Lock,
  ExternalLink,
  ShieldAlert,
  Tv,
  Radio,
  Sliders,
  Clock,
} from 'lucide-react';
import {
  MatrixSession,
  StationMatrixData,
  PricingTier,
} from '../types';
import {
  fetchStationMatrix,
  startCategorySessionApi,
  extendSessionApi,
} from '../api';
import { useNotificationStore } from '../store/notificationStore';
import { POLL_INTERVALS, DEFAULT_HOURLY_RATE } from '../constants';

interface ConsoleMatrixDashboardProps {
  onOrderFood: (session: MatrixSession, stationName: string) => void;
  onCheckout: (session: MatrixSession, stationName: string) => void;
  onTransfer: (session: MatrixSession, stationName: string) => void;
  onQuickExtend?: (session: MatrixSession, minutes: number) => void;
}

export const ConsoleMatrixDashboard: React.FC<ConsoleMatrixDashboardProps> = ({
  onOrderFood,
  onCheckout,
  onTransfer,
  onQuickExtend,
}) => {
  const queryClient = useQueryClient();
  const { addNotification } = useNotificationStore();

  // Selected duration per cell: map key `${modeId}-${stationId}` -> duration_minutes
  const [selectedDurations, setSelectedDurations] = useState<Record<string, number>>({});
  // Optional customer name per cell: map key `${modeId}-${stationId}` -> name
  const [customerNames, setCustomerNames] = useState<Record<string, string>>({});
  // Starting session loading state: `${modeId}-${stationId}`
  const [initiatingCell, setInitiatingCell] = useState<string | null>(null);
  // Extending session loading state: sessionId
  const [extendingSessionId, setExtendingSessionId] = useState<string | null>(null);
  // Active cell focus highlight: cell key `${modeId}-${stationId}`
  const [focusedCellKey, setFocusedCellKey] = useState<string | null>(null);

  // Live seconds ticker for countdown timers
  const [currentTime, setCurrentTime] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch Matrix Data
  const {
    data: matrixData = { modes: [], stations: [] },
    isLoading,
  } = useQuery<StationMatrixData>({
    queryKey: ['station-matrix'],
    queryFn: fetchStationMatrix,
    refetchInterval: POLL_INTERVALS.STATIONS,
  });

  const modes = Array.isArray(matrixData?.modes) ? matrixData.modes : [];

  // Strictly enforce 3 columns at all times: PS1, PS2, PS3 (even if other devices exist)
  const rawStations = Array.isArray(matrixData?.stations) ? matrixData.stations : [];
  const desiredStationNames = ['PS1', 'PS2', 'PS3'];
  const stations = desiredStationNames.map((name) => {
    const found = rawStations.find((s) => s.name?.toUpperCase() === name.toUpperCase());
    return (
      found || {
        id: name,
        name: name,
        device_type: 'CONSOLE',
        status: 'AVAILABLE' as const,
        supported_modes: ['solo', 'multiplayer', 'car_sim'],
        active_session: null,
      }
    );
  });

  // Cell reference map for smooth scroll and highlight focus
  const cellRefs = useRef<Record<string, HTMLTableCellElement | null>>({});

  // Helper: focus and highlight a specific active cell
  const handleFocusActiveCell = (targetModeId: string, targetStationId: string) => {
    const cellKey = `${targetModeId}-${targetStationId}`;
    setFocusedCellKey(cellKey);
    const element = cellRefs.current[cellKey];
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    // Remove focus highlight after 2.8 seconds
    setTimeout(() => {
      setFocusedCellKey((curr) => (curr === cellKey ? null : curr));
    }, 2800);
  };

  // Session Initiation Mutation
  const startSessionMutation = useMutation({
    mutationFn: async ({
      stationId,
      modeId,
      durationMinutes,
      modeName,
      customerName,
    }: {
      stationId: string;
      modeId: string;
      durationMinutes: number;
      modeName: string;
      customerName?: string;
    }) => {
      setInitiatingCell(`${modeId}-${stationId}`);
      // Exact payload per spec: { station_id, mode, duration_minutes }
      return startCategorySessionApi({
        station_id: stationId,
        mode: modeName,
        category_id: modeId,
        device_id: stationId,
        duration_minutes: durationMinutes,
        customer_name: customerName?.trim() || 'Walk-in Gamer',
      });
    },
    onSuccess: async (_, vars) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['station-matrix'] }),
        queryClient.invalidateQueries({ queryKey: ['stations-live'] }),
        queryClient.invalidateQueries({ queryKey: ['customer-sessions'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-customers'] }),
        queryClient.invalidateQueries({ queryKey: ['fleet-categories'] }),
      ]);
      addNotification(
        'SYSTEM',
        '🎮 Session Started',
        `Started ${vars.modeName} on ${vars.stationId} for ${vars.durationMinutes} mins.`
      );
    },
    onError: (err: any) => {
      addNotification('SYSTEM', '⚠️ Check-in Failed', err.message || 'Could not start session.');
    },
    onSettled: () => {
      setInitiatingCell(null);
    },
  });

  // Quick Extend Session Handler
  const handleExtend = async (session: MatrixSession, minutes: number) => {
    setExtendingSessionId(session.session_id);
    try {
      await extendSessionApi(session.session_id, minutes);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['station-matrix'] }),
        queryClient.invalidateQueries({ queryKey: ['stations-live'] }),
        queryClient.invalidateQueries({ queryKey: ['customer-sessions'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-customers'] }),
      ]);
      if (onQuickExtend) {
        onQuickExtend(session, minutes);
      } else {
        addNotification(
          'SYSTEM',
          '⏱️ Session Extended',
          `Extended ${session.station_id} (${session.mode_name}) by +${minutes} minutes.`
        );
      }
    } catch (err: any) {
      addNotification('SYSTEM', '⚠️ Extend Failed', err.message || 'Could not extend session.');
    } finally {
      setExtendingSessionId(null);
    }
  };

  // Helper for mode icons & theme accents
  const getModeTheme = (modeId: string, modeName: string = '') => {
    const key = `${modeId} ${modeName}`.toLowerCase();
    if (key.includes('car') || key.includes('sim')) {
      return {
        icon: <Sparkles className="w-4 h-4 text-amber-400" />,
        badge: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
        activeGlow: 'border-amber-500/70 shadow-[0_0_20px_rgba(245,158,11,0.2)]',
        headerBg: 'from-amber-950/40 to-slate-900/90',
        textAccent: 'text-amber-400',
        pillBg: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
      };
    }
    if (key.includes('vr')) {
      return {
        icon: <Cpu className="w-4 h-4 text-teal-400" />,
        badge: 'bg-teal-500/15 text-teal-300 border-teal-500/40',
        activeGlow: 'border-teal-500/70 shadow-[0_0_20px_rgba(20,184,166,0.2)]',
        headerBg: 'from-teal-950/40 to-slate-900/90',
        textAccent: 'text-teal-400',
        pillBg: 'bg-teal-500/20 text-teal-300 border-teal-500/40',
      };
    }
    if (key.includes('multi')) {
      return {
        icon: <Users className="w-4 h-4 text-purple-400" />,
        badge: 'bg-purple-500/15 text-purple-300 border-purple-500/40',
        activeGlow: 'border-purple-500/70 shadow-[0_0_20px_rgba(168,85,247,0.2)]',
        headerBg: 'from-purple-950/40 to-slate-900/90',
        textAccent: 'text-purple-400',
        pillBg: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
      };
    }
    return {
      icon: <Gamepad2 className="w-4 h-4 text-emerald-400" />,
      badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
      activeGlow: 'border-emerald-500/70 shadow-[0_0_20px_rgba(16,185,129,0.2)]',
      headerBg: 'from-emerald-950/40 to-slate-900/90',
      textAccent: 'text-emerald-400',
      pillBg: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    };
  };

  // Format dynamic countdown timer (seconds precision)
  const formatLiveCountdown = (startedAtIso: string, allocatedMinutes: number) => {
    try {
      const startMs = new Date(startedAtIso).getTime();
      const elapsedSec = Math.max(0, Math.floor((currentTime - startMs) / 1000));
      const totalAllocSec = (allocatedMinutes || 60) * 60;
      const remainingSec = Math.max(0, totalAllocSec - elapsedSec);

      const remHrs = Math.floor(remainingSec / 3600);
      const remMins = Math.floor((remainingSec % 3600) / 60);
      const remSecs = remainingSec % 60;

      const elHrs = Math.floor(elapsedSec / 3600);
      const elMins = Math.floor((elapsedSec % 3600) / 60);

      const timeRemainingStr =
        remHrs > 0
          ? `${remHrs}h ${remMins.toString().padStart(2, '0')}m`
          : `${remMins}:${remSecs.toString().padStart(2, '0')}`;

      const elapsedStr = elHrs > 0 ? `${elHrs}h ${elMins}m` : `${elMins}m`;

      return {
        remainingStr: timeRemainingStr,
        elapsedStr,
        isOvertime: remainingSec === 0 && elapsedSec > totalAllocSec,
        progressPercent: Math.min(100, Math.round((elapsedSec / totalAllocSec) * 100)),
      };
    } catch {
      return {
        remainingStr: '00:00',
        elapsedStr: '0m',
        isOvertime: false,
        progressPercent: 0,
      };
    }
  };

  // Format projected availability time (e.g., "Available at 9:00 PM", "35m left")
  const formatExpectedAvailableTime = (startedAtIso: string, allocatedMinutes: number) => {
    try {
      const startMs = new Date(startedAtIso).getTime();
      const totalAllocMs = (allocatedMinutes || 60) * 60 * 1000;
      const endMs = startMs + totalAllocMs;
      const remainingMs = endMs - currentTime;
      const remainingMins = Math.max(0, Math.ceil(remainingMs / (60 * 1000)));
      const isOvertime = remainingMs <= 0;

      const endDate = new Date(endMs);
      const timeStr = endDate.toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });

      return {
        timeStr,
        remainingMins,
        isOvertime,
        remainingBadge: isOvertime ? 'Overdue' : `${remainingMins}m left`,
      };
    } catch {
      return {
        timeStr: 'Soon',
        remainingMins: 0,
        isOvertime: false,
        remainingBadge: 'Active',
      };
    }
  };

  if (isLoading && modes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-20 bg-slate-900/60 rounded-3xl border border-slate-800 space-y-4">
        <div className="w-10 h-10 rounded-full border-3 border-emerald-400 border-t-transparent animate-spin" />
        <p className="text-xs font-mono-code text-slate-400 tracking-wider uppercase">
          Initializing 2D Allocation Matrix...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* The 2D Station Allocation Matrix Table */}
      <div className="bg-slate-900/90 rounded-3xl border border-slate-800 shadow-2xl overflow-hidden backdrop-blur-xl">
        <div className="overflow-x-auto pb-2">
          <table className="w-full text-left border-collapse min-w-[850px]">
            {/* Table Header: Columns = Physical Stations */}
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/90">
                {/* Top-Left Corner: Game Modes & Categories Label */}
                <th className="p-4 sm:p-5 w-56 min-w-[200px] border-r border-slate-800 align-middle">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 shrink-0">
                      <Sliders className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="text-xs font-black uppercase tracking-wider text-white font-display block">
                        Modes \ Stations
                      </span>
                      <span className="text-[10px] text-slate-400 font-normal">
                        Experience vs. Console
                      </span>
                    </div>
                  </div>
                </th>

                {/* Each Column Header: Physical Station ("PS1", "PS2", "PS3") with Live Station Availability */}
                {stations.map((station) => {
                  const activeSession = station.active_session;
                  const hasActive = !!activeSession;
                  const availInfo = hasActive && activeSession?.started_at
                    ? formatExpectedAvailableTime(activeSession.started_at, activeSession.allocated_minutes)
                    : null;

                  return (
                    <th
                      key={station.id}
                      className="p-4 sm:p-5 min-w-[280px] border-r last:border-r-0 border-slate-800 align-top bg-slate-950/70"
                    >
                      <div className="space-y-3">
                        {/* Top Line: Station Name & Quick Status */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5">
                            <div className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-300">
                              <Tv className="w-4 h-4 text-slate-400" />
                            </div>
                            <div>
                              <span className="text-base font-black text-white font-display tracking-wide block leading-none">
                                {station.name}
                              </span>
                              <span className="text-[10px] font-mono-code text-slate-500 uppercase">
                                {station.device_type || 'Console'}
                              </span>
                            </div>
                          </div>
                          <span
                            className={`text-[10px] font-mono-code font-bold uppercase px-2.5 py-1 rounded-full border ${
                              hasActive
                                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                            }`}
                          >
                            {hasActive ? 'Occupied' : 'Free'}
                          </span>
                        </div>

                        {/* Common Station Availability Header Pill */}
                        {!hasActive || !activeSession || !availInfo ? (
                          <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
                            <div className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                              <span className="font-mono-code font-bold text-xs text-emerald-300">
                                Available Now
                              </span>
                            </div>
                            <span className="inline-flex items-center gap-1 text-[10px] font-mono-code font-semibold text-emerald-400/90">
                              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                              <span>Ready</span>
                            </span>
                          </div>
                        ) : (
                          <div className="px-3 py-2 rounded-xl bg-slate-900/90 border border-amber-500/40 space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                <span className="font-mono-code font-bold text-xs text-white truncate">
                                  Available at {availInfo.timeStr}
                                </span>
                              </div>
                              <span
                                className={`text-[9px] font-mono-code font-bold px-2 py-0.5 rounded-full shrink-0 border ${
                                  availInfo.isOvertime
                                    ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                                    : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                                }`}
                              >
                                {availInfo.remainingBadge}
                              </span>
                            </div>
                            {activeSession.customer_name && (
                              <div className="text-[10px] font-mono-code text-slate-400 truncate flex items-center gap-1">
                                <span className="text-slate-500">Player:</span>
                                <span className="text-slate-200 font-semibold truncate">{activeSession.customer_name}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>

            {/* Table Body: Rows = Game Modes/Categories ("Solo", "Multiplayer", "Car Simulator") */}
            <tbody className="divide-y divide-slate-800/80">
              {modes.map((mode) => {
                const modeTheme = getModeTheme(mode.id, mode.name);

                return (
                  <tr key={mode.id} className="hover:bg-slate-800/20 transition-colors">
                    {/* Row Header: Game Mode Title & Tier */}
                    <td className="p-4 sm:p-5 border-r border-slate-800 align-top bg-slate-950/40 w-56 min-w-[200px]">
                      <div className="flex items-center gap-2.5">
                        <span className={`p-2 rounded-xl border ${modeTheme.badge}`}>
                          {modeTheme.icon}
                        </span>
                        <div>
                          <h4 className="text-base font-black text-white font-display tracking-wide">
                            {mode.name}
                          </h4>
                          <span className="text-[10px] font-mono-code font-bold uppercase text-slate-400">
                            {mode.tier}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Matrix Cells: (Row: Mode, Column: Station) */}
                    {stations.map((station, stationIndex) => {
                      const isVrRow = mode.id.toLowerCase().includes('vr') || mode.name.toLowerCase().includes('vr');

                      // VR Row Decoupling: Only rendered in Column 1 (stationIndex === 0). Columns 2 & 3 are dedicated rig slots.
                      if (isVrRow && stationIndex > 0) {
                        return (
                          <td
                            key={station.id}
                            className="p-3.5 sm:p-4 border-r last:border-r-0 border-slate-800 align-middle bg-slate-950/20"
                          >
                            <div className="p-4 rounded-2xl bg-slate-950/30 border border-dashed border-slate-800/60 flex flex-col items-center justify-center text-center select-none py-8 space-y-2">
                              <Cpu className="w-5 h-5 text-teal-400/40" />
                              <span className="text-[10px] font-mono-code uppercase text-slate-400 font-bold">
                                Dedicated VR Rig
                              </span>
                              <p className="text-[10px] text-slate-500">
                                VR Headset Station operates in Column 1
                              </p>
                            </div>
                          </td>
                        );
                      }

                      // Effective Station & Session details
                      const effectiveStationId = isVrRow ? 'VR1' : station.id;
                      const effectiveStationName = isVrRow ? 'VR1' : station.name;
                      const cellKey = `${mode.id}-${effectiveStationId}`;
                      const isFocused = focusedCellKey === cellKey;
                      const activeSession = isVrRow ? matrixData.vr_session : station.active_session;
                      const hasActiveSession = !!activeSession;

                      // Check if supported hardware
                      const isSupportedHardware = isVrRow
                        ? true
                        : mode.supported_stations.some(
                            (stName) => stName.toUpperCase() === station.name.toUpperCase()
                          );

                      // Normalize mode matching
                      const sessionModeRaw = (activeSession?.mode || '').toLowerCase();
                      const thisModeRaw = mode.id.toLowerCase();
                      const isModeMatch = isVrRow
                        ? hasActiveSession
                        : (sessionModeRaw === thisModeRaw ||
                           (thisModeRaw === 'car_sim' && sessionModeRaw.includes('car')) ||
                           (thisModeRaw === 'multiplayer' && sessionModeRaw.includes('multi')) ||
                           (thisModeRaw === 'solo' && sessionModeRaw.includes('solo')) ||
                           (thisModeRaw === 'vr_sim' && sessionModeRaw.includes('vr')));

                      // Cell State Logic
                      const isStateA = hasActiveSession && isModeMatch;
                      const isStateC = !isVrRow && hasActiveSession && !isModeMatch;
                      const isStateB = !hasActiveSession && isSupportedHardware;

                      // Pricing tiers for this cell
                      const pricingTiers: PricingTier[] =
                        Array.isArray(mode.pricing_tiers) && mode.pricing_tiers.length > 0
                          ? mode.pricing_tiers
                          : [
                              {
                                duration_min: 30,
                                price: Math.round(Number(mode.hourly_rate || DEFAULT_HOURLY_RATE) * 0.55),
                                label: '30 mins',
                              },
                              {
                                duration_min: 60,
                                price: Number(mode.hourly_rate || DEFAULT_HOURLY_RATE),
                                label: '1 hr',
                              },
                              {
                                duration_min: 120,
                                price: Math.round(Number(mode.hourly_rate || DEFAULT_HOURLY_RATE) * 1.8),
                                label: '2 hrs',
                              },
                            ];

                      const defaultTier = pricingTiers.find((t) => t.duration_min === 60) || pricingTiers[0];
                      const selectedDuration =
                        selectedDurations[cellKey] ?? defaultTier?.duration_min ?? 60;
                      const isInitiating = initiatingCell === cellKey;

                      return (
                        <td
                          key={station.id}
                          ref={(el) => {
                            cellRefs.current[cellKey] = el;
                          }}
                          className={`p-3.5 sm:p-4 border-r last:border-r-0 border-slate-800 align-top transition-all duration-300 relative ${
                            isFocused
                              ? 'ring-2 ring-emerald-400 bg-emerald-950/30 scale-[1.01] z-20 shadow-2xl'
                              : ''
                          }`}
                        >
                          {/* ========================================================================= */}
                          {/* STATE A: ACTIVE HERE */}
                          {/* ========================================================================= */}
                          {isStateA && activeSession && (
                            <div className="p-3.5 rounded-2xl bg-slate-950/95 border border-emerald-500/50 shadow-lg space-y-3 relative overflow-hidden">
                              {/* Glowing top line */}
                              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400" />

                              {/* Customer Header & Active Pill */}
                              <div className="flex items-center justify-between gap-1.5 pt-1">
                                <div className="truncate">
                                  <span className="text-xs font-black text-white font-display truncate block">
                                    {activeSession.customer_name}
                                  </span>
                                  {activeSession.customer_phone && (
                                    <span className="text-[10px] font-mono-code text-slate-400">
                                      {activeSession.customer_phone}
                                    </span>
                                  )}
                                </div>
                                <span className="inline-flex items-center gap-1 text-[10px] font-mono-code font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                                  <Radio className="w-2.5 h-2.5 animate-pulse text-emerald-400" />
                                  <span>{isVrRow ? 'VR Active' : 'Active Here'}</span>
                                </span>
                              </div>

                              {/* 1. Countdown Timer (Time left, elapsed) */}
                              {(() => {
                                const countdown = formatLiveCountdown(
                                  activeSession.started_at,
                                  activeSession.allocated_minutes
                                );
                                return (
                                  <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-1.5">
                                    <div className="flex items-center justify-between text-xs">
                                      <div className="flex items-center gap-1.5 text-slate-400">
                                        <Timer className="w-3.5 h-3.5 text-emerald-400" />
                                        <span className="font-mono-code text-[11px]">Time Left:</span>
                                      </div>
                                      <span
                                        className={`font-mono-code font-black text-sm ${
                                          countdown.isOvertime ? 'text-rose-400 animate-pulse' : 'text-emerald-400'
                                        }`}
                                      >
                                        {countdown.remainingStr}
                                      </span>
                                    </div>

                                    {/* Progress Bar */}
                                    <div className="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden">
                                      <div
                                        className={`h-full transition-all duration-1000 ${
                                          countdown.isOvertime
                                            ? 'bg-rose-500'
                                            : 'bg-gradient-to-r from-emerald-500 to-teal-400'
                                        }`}
                                        style={{ width: `${countdown.progressPercent}%` }}
                                      />
                                    </div>

                                    <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono-code">
                                      <span>Elapsed: {countdown.elapsedStr}</span>
                                      <span>Booked: {activeSession.allocated_minutes}m</span>
                                    </div>
                                  </div>
                                );
                              })()}

                              {/* 2. Billing Metrics: Play Charges, Snack Charges, Total Billable Amount */}
                              <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-1 text-[11px] font-mono-code">
                                <div className="flex justify-between text-slate-400">
                                  <span>Play Charges:</span>
                                  <span className="text-white font-bold">
                                    ₹{Number(activeSession.time_charge || 0).toFixed(2)}
                                  </span>
                                </div>
                                <div className="flex justify-between text-slate-400">
                                  <span>Snack Charges:</span>
                                  <span className="text-white font-bold">
                                    ₹{Number(activeSession.orders_charge || 0).toFixed(2)}
                                  </span>
                                </div>
                                <div className="flex justify-between font-bold text-white pt-1 border-t border-slate-800/80">
                                  <span className="text-emerald-300">Total Billable:</span>
                                  <span className="text-emerald-400 font-black text-xs">
                                    ₹{Number(activeSession.running_total || 0).toFixed(2)}
                                  </span>
                                </div>
                              </div>

                              {/* 3. Action Buttons: Order Food & Drinks, Generate Bill & Checkout, Transfer, +30m, +1h */}
                              <div className="space-y-1.5 pt-1">
                                {/* Order Food & Drinks */}
                                <button
                                  onClick={() => onOrderFood(activeSession, effectiveStationName)}
                                  className="w-full py-2 px-2.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 font-bold text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                                >
                                  <UtensilsCrossed className="w-3.5 h-3.5 text-amber-400" />
                                  <span>Order Food &amp; Drinks</span>
                                </button>

                                {/* Generate Bill & Checkout */}
                                <button
                                  onClick={() => onCheckout(activeSession, effectiveStationName)}
                                  className="w-full py-2 px-2.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 font-bold text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                                >
                                  <Receipt className="w-3.5 h-3.5 text-emerald-400" />
                                  <span>Generate Bill &amp; Checkout</span>
                                </button>

                                {/* Action Buttons Row: Transfer, +30m, +1h */}
                                <div className="grid grid-cols-3 gap-1.5 pt-0.5">
                                  <button
                                    onClick={() => onTransfer(activeSession, effectiveStationName)}
                                    className="py-1.5 px-2 rounded-xl bg-blue-500/15 hover:bg-blue-500/25 border border-blue-500/30 text-blue-300 font-bold text-[10px] transition-all flex items-center justify-center gap-1 cursor-pointer"
                                    title="Transfer player to another station"
                                  >
                                    <ArrowRightLeft className="w-3 h-3 text-blue-400" />
                                    <span>Transfer</span>
                                  </button>

                                  <button
                                    disabled={extendingSessionId === activeSession.session_id}
                                    onClick={() => handleExtend(activeSession, 30)}
                                    className="py-1.5 px-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-white font-mono-code font-bold text-[10px] transition-all flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
                                    title="Add 30 minutes to this session"
                                  >
                                    <PlusCircle className="w-3 h-3 text-emerald-400" />
                                    <span>+30m</span>
                                  </button>

                                  <button
                                    disabled={extendingSessionId === activeSession.session_id}
                                    onClick={() => handleExtend(activeSession, 60)}
                                    className="py-1.5 px-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-white font-mono-code font-bold text-[10px] transition-all flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
                                    title="Add 1 hour to this session"
                                  >
                                    <PlusCircle className="w-3 h-3 text-teal-400" />
                                    <span>+1h</span>
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* ========================================================================= */}
                          {/* STATE B: AVAILABLE */}
                          {/* ========================================================================= */}
                          {isStateB && (
                            <div className="p-3.5 rounded-2xl bg-slate-950/60 border border-slate-800 hover:border-slate-700 transition-all space-y-3">
                              {/* Station Availability Status */}
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-slate-400 font-medium">
                                  {isVrRow ? 'VR Rig Ready:' : 'Console Free:'}
                                </span>
                                <span className="inline-flex items-center gap-1 text-[10px] font-mono-code font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                                  <CheckCircle2 className="w-2.5 h-2.5" />
                                  <span>Ready</span>
                                </span>
                              </div>

                              {/* Optional Customer Name Input */}
                              <div className="space-y-1">
                                <label className="text-[10px] font-mono-code uppercase text-slate-400 font-bold block">
                                  Customer Name:
                                </label>
                                <input
                                  type="text"
                                  placeholder="Walk-in Gamer"
                                  value={customerNames[cellKey] || ''}
                                  onChange={(e) =>
                                    setCustomerNames((prev) => ({
                                      ...prev,
                                      [cellKey]: e.target.value,
                                    }))
                                  }
                                  className="w-full px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/70 font-mono-code transition-colors"
                                />
                              </div>

                              {/* Duration Selector Buttons: [30 mins], [1 hr], [2 hrs] */}
                              <div className="space-y-1.5">
                                <div className="text-[10px] font-mono-code uppercase text-slate-400 font-bold">
                                  Select Duration:
                                </div>

                                <div className="grid grid-cols-3 gap-1.5">
                                  {pricingTiers.map((tier) => {
                                    const isSelected = selectedDuration === tier.duration_min;
                                    return (
                                      <button
                                        key={tier.duration_min}
                                        type="button"
                                        onClick={() =>
                                          setSelectedDurations((prev) => ({
                                            ...prev,
                                            [cellKey]: tier.duration_min,
                                          }))
                                        }
                                        className={`py-2 px-1 rounded-xl text-center transition-all font-display border cursor-pointer ${
                                          isSelected
                                            ? 'bg-emerald-500/25 border-emerald-400 text-white shadow-sm ring-1 ring-emerald-400/50'
                                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                                        }`}
                                      >
                                        <div className="text-[11px] font-bold tracking-tight">
                                          {tier.label || `${tier.duration_min}m`}
                                        </div>
                                        <div className="text-[10px] font-mono-code text-emerald-400 font-bold">
                                          ₹{Number(tier.price).toFixed(0)}
                                        </div>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>

                              {/* "Start [Mode]" Action Button */}
                              <button
                                disabled={isInitiating}
                                onClick={() =>
                                  startSessionMutation.mutate({
                                    stationId: effectiveStationName,
                                    modeId: mode.id,
                                    durationMinutes: selectedDuration,
                                    modeName: mode.name,
                                    customerName: customerNames[cellKey],
                                  })
                                }
                                className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-black text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 shadow-md active:scale-98 cursor-pointer disabled:opacity-50"
                              >
                                {isInitiating ? (
                                  <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                                ) : (
                                  <>
                                    <Play className="w-3.5 h-3.5 fill-current" />
                                    <span>Start {mode.name}</span>
                                  </>
                                )}
                              </button>
                            </div>
                          )}

                          {/* ========================================================================= */}
                          {/* STATE C: OCCUPIED ELSEWHERE */}
                          {/* ========================================================================= */}
                          {isStateC && activeSession && (
                            <div
                              onClick={() => handleFocusActiveCell(activeSession.mode, station.id)}
                              className="p-3.5 rounded-2xl bg-slate-950/40 border border-slate-800/80 opacity-60 hover:opacity-100 hover:border-blue-500/50 transition-all duration-200 cursor-pointer space-y-2.5 group"
                              title={`Click to focus active session on ${activeSession.mode_name}`}
                            >
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-slate-500 font-medium">Console In Use</span>
                                <Lock className="w-3.5 h-3.5 text-slate-500 group-hover:text-blue-400 transition-colors" />
                              </div>

                              {/* Status Pill: "Active in [Other Mode]" */}
                              <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 group-hover:border-blue-500/40 transition-colors space-y-1.5">
                                <span className="inline-flex items-center gap-1 text-[10px] font-mono-code font-bold uppercase px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/30">
                                  <span>Active in {activeSession.mode_name}</span>
                                </span>

                                <p className="text-[11px] text-slate-400 truncate">
                                  Player: <strong className="text-white">{activeSession.customer_name}</strong>
                                </p>
                              </div>

                              {/* Quick link to focus active cell */}
                              <div className="flex items-center justify-center gap-1 text-[11px] text-blue-400 font-semibold group-hover:text-blue-300 pt-0.5">
                                <span>Focus Active Session</span>
                                <ExternalLink className="w-3 h-3" />
                              </div>
                            </div>
                          )}

                          {/* Hardware Incompatible Fallback */}
                          {!isSupportedHardware && (
                            <div className="p-3.5 rounded-2xl bg-slate-950/30 border border-dashed border-slate-800/60 opacity-40 space-y-2 flex flex-col items-center justify-center text-center select-none">
                              <ShieldAlert className="w-5 h-5 text-slate-600" />
                              <div className="text-[10px] font-mono-code uppercase text-slate-500 font-bold">
                                Rig Incompatible
                              </div>
                              <p className="text-[10px] text-slate-600">
                                {mode.name} requires {mode.supported_stations.join(', ')}
                              </p>
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
