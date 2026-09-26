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
  ChevronDown,
  ChevronUp,
  Phone,
} from 'lucide-react';
import {
  MatrixSession,
  StationMatrixData,
  PricingTier,
  Order,
} from '../types';
import {
  fetchStationMatrix,
  startCategorySessionApi,
  extendSessionApi,
} from '../api';
import { useNotificationStore } from '../store/notificationStore';
import { useLoungeStore } from '../store/loungeStore';
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
  const { inSeatOrders, updateInSeatOrderStatus, flashingStationId } = useLoungeStore();

  // Accordion expanded state for orders: orderId -> boolean
  const [expandedOrdersMap, setExpandedOrdersMap] = useState<Record<string, boolean>>({});

  const toggleOrderExpand = (orderId: string) => {
    setExpandedOrdersMap((prev) => ({ ...prev, [orderId]: !prev[orderId] }));
  };

  const handleToggleOrderStatus = (orderId: string, currentStatus: string) => {
    const nextStatus = currentStatus === 'pending' ? 'preparing' : currentStatus === 'preparing' ? 'delivered' : 'pending';
    updateInSeatOrderStatus(orderId, nextStatus as any);
    addNotification(
      'FOOD_ORDER',
      'Order Status Advanced',
      `Order status updated to ${nextStatus.toUpperCase()}.`
    );
  };

  // Selected duration per cell: map key `${modeId}-${stationId}` -> duration_minutes
  const [selectedDurations, setSelectedDurations] = useState<Record<string, number>>({});
  // Optional customer name per cell: map key `${modeId}-${stationId}` -> name
  const [customerNames, setCustomerNames] = useState<Record<string, string>>({});
  // Optional customer phone per cell: map key `${modeId}-${stationId}` -> phone
  const [customerPhones, setCustomerPhones] = useState<Record<string, string>>({});
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
      customerPhone,
    }: {
      stationId: string;
      modeId: string;
      durationMinutes: number;
      modeName: string;
      customerName?: string;
      customerPhone?: string;
    }) => {
      setInitiatingCell(`${modeId}-${stationId}`);
      // Exact payload: { station_id, mode, duration_minutes, customer_name, customer_phone }
      return startCategorySessionApi({
        station_id: stationId,
        mode: modeName,
        category_id: modeId,
        device_id: stationId,
        duration_minutes: durationMinutes,
        customer_name: customerName?.trim() || 'Walk-in Gamer',
        customer_phone: customerPhone?.trim() || undefined,
      });
    },
    onSuccess: async (_, vars) => {
      // Clear inputs for this cell
      setCustomerNames((prev) => {
        const next = { ...prev };
        delete next[`${vars.modeId}-${vars.stationId}`];
        return next;
      });
      setCustomerPhones((prev) => {
        const next = { ...prev };
        delete next[`${vars.modeId}-${vars.stationId}`];
        return next;
      });
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
      <div className="flex flex-col items-center justify-center p-20 bg-[#FFFFFF] rounded-3xl border border-[#E2E8F0] space-y-4 shadow-sm">
        <div className="w-10 h-10 rounded-full border-3 border-[#EA580C] border-t-transparent animate-spin" />
        <p className="text-xs text-[#64748B] tracking-wider uppercase font-semibold">
          Initializing Station Allocation Matrix...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* The 2D Station Allocation Matrix Table */}
      <div className="bg-[#FFFFFF] rounded-2xl sm:rounded-3xl border border-[#E2E8F0] shadow-sm overflow-hidden">
        <div className="overflow-x-auto pb-2">
          <table className="w-full text-left border-collapse min-w-[850px]">
            {/* Table Header: Columns = Physical Stations */}
            <thead>
              <tr className="border-b border-[#E2E8F0] bg-[#FFF7ED]">
                {/* Top-Left Corner: Game Modes & Categories Label */}
                <th className="p-4 sm:p-5 w-56 min-w-[200px] border-r border-[#E2E8F0] align-middle bg-[#FFF7ED]">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-xl bg-[#FFFFFF] border border-[#E2E8F0] text-[#172554] shrink-0 shadow-xs">
                      <Sliders className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="text-xs font-black uppercase tracking-wider text-[#172554] font-display block">
                        Modes \ Stations
                      </span>
                      <span className="text-[10px] text-[#64748B] font-normal">
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

                  const isFlashing = flashingStationId === station.name.toUpperCase();

                  const stationPendingCount = (inSeatOrders || []).filter(
                    (o) => o?.stationId?.toUpperCase() === station.name.toUpperCase() && o?.status === 'pending'
                  ).length;

                  return (
                    <th
                      key={station.id}
                      className={`p-4 sm:p-5 min-w-[280px] border-r last:border-r-0 border-[#E2E8F0] align-top bg-[#FFFFFF] transition-all duration-300 ${
                        isFlashing
                          ? 'bg-[#FFEDD5] ring-2 ring-[#FED7AA]'
                          : 'bg-[#FFFFFF]'
                      }`}
                    >
                      <div className="space-y-3">
                        {/* Top Line: Station Name & Quick Status */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5">
                            <div className="p-2 rounded-xl bg-[#FFF7ED] border border-[#E2E8F0] text-[#172554]">
                              <Tv className="w-4 h-4 text-[#172554]" />
                            </div>
                            <div>
                              <span className="text-base font-black text-[#172554] font-display tracking-wide block leading-none">
                                {station.name}
                              </span>
                              <span className="text-[10px] text-[#64748B] uppercase">
                                {station.device_type || 'Console'}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 flex-wrap justify-end">
                            {stationPendingCount > 0 && (
                              <span className="text-[10px] font-bold uppercase px-2.5 py-1 rounded-full border bg-[#FFEDD5] text-[#C2410C] border-[#FED7AA] animate-pulse">
                                {stationPendingCount} New Order{stationPendingCount > 1 ? 's' : ''}
                              </span>
                            )}
                            <span
                              className={`text-[10px] font-bold uppercase px-2.5 py-1 rounded-full border ${
                                hasActive
                                  ? 'bg-[#FEF3C7] text-[#B45309] border-[#FDE68A]'
                                  : 'bg-[#DCFCE7] text-[#15803D] border-[#BBF7D0]'
                              }`}
                            >
                              {hasActive ? 'Occupied' : 'FREE'}
                            </span>
                          </div>
                        </div>

                        {/* Common Station Availability Header Pill */}
                        {!hasActive || !activeSession || !availInfo ? (
                          <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-[#F1F5F9] border border-[#E2E8F0]">
                            <div className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-[#15803D] shrink-0" />
                              <span className="font-bold text-xs text-[#15803D]">
                                Available Now
                              </span>
                            </div>
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#15803D]">
                              <CheckCircle2 className="w-3 h-3 text-[#15803D]" />
                              <span>Ready</span>
                            </span>
                          </div>
                        ) : (
                          <div className="px-3 py-2 rounded-xl bg-[#FFF7ED] border border-[#FED7AA] space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <Clock className="w-3.5 h-3.5 text-[#EA580C] shrink-0" />
                                <span className="font-bold text-xs text-[#172554] truncate">
                                  Available at {availInfo.timeStr}
                                </span>
                              </div>
                              <span
                                className={`text-[9px] font-bold px-2 py-0.5 rounded-full shrink-0 border ${
                                  availInfo.isOvertime
                                    ? 'bg-[#FEE2E2] text-[#B91C1C] border-[#FECACA]'
                                    : 'bg-[#FFEDD5] text-[#C2410C] border-[#FED7AA]'
                                }`}
                              >
                                {availInfo.remainingBadge}
                              </span>
                            </div>
                            {activeSession.customer_name && (
                              <div className="text-[10px] text-[#64748B] truncate flex items-center gap-1.5">
                                <span className="text-[#64748B]">Player:</span>
                                <span className="text-[#0F172A] font-semibold truncate">{activeSession.customer_name}</span>
                                {activeSession.customer_phone && (
                                  <span className="text-[#64748B] font-mono font-medium">({activeSession.customer_phone})</span>
                                )}
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
            <tbody className="divide-y divide-[#E2E8F0]">
              {modes.map((mode) => {
                const modeTheme = getModeTheme(mode.id, mode.name);

                return (
                  <tr key={mode.id} className="hover:bg-[#FFF7ED]/40 transition-colors">
                    {/* Row Header: Game Mode Title & Tier */}
                    <td className="p-4 sm:p-5 border-r border-[#E2E8F0] align-top bg-[#FFFFFF] w-56 min-w-[200px]">
                      <div className="flex items-center gap-2.5">
                        <span className="p-2 rounded-xl border border-[#E2E8F0] bg-[#FFF7ED] text-[#172554] shadow-xs">
                          {modeTheme.icon}
                        </span>
                        <div>
                          <h4 className="text-base font-black text-[#172554] font-display tracking-wide">
                            {mode.name}
                          </h4>
                          <span className="text-[10px] font-bold uppercase text-[#64748B]">
                            {mode.tier}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Matrix Cells: (Row: Mode, Column: Station) */}
                    {(() => {
                      const isVrRow = mode.id.toLowerCase().includes('vr') || mode.name.toLowerCase().includes('vr');

                      if (isVrRow) {
                        const vrActiveSession = matrixData?.vr_session;
                        const hasVrSession = !!vrActiveSession;
                        const vrCellKey = `${mode.id}-VR1`;
                        const isFocused = focusedCellKey === vrCellKey;
                        const vrPricingTiers: PricingTier[] =
                          Array.isArray(mode.pricing_tiers) && mode.pricing_tiers.length > 0
                            ? mode.pricing_tiers
                            : [
                                {
                                  duration_min: 30,
                                  price: Math.round(Number(mode.hourly_rate || 300) * 0.55),
                                  label: '30 mins',
                                },
                                {
                                  duration_min: 60,
                                  price: Number(mode.hourly_rate || 300),
                                  label: '1 hr',
                                },
                                {
                                  duration_min: 120,
                                  price: Math.round(Number(mode.hourly_rate || 300) * 1.8),
                                  label: '2 hrs',
                                },
                              ];
                        const defaultTier = vrPricingTiers.find((t) => t.duration_min === 60) || vrPricingTiers[0];
                        const selectedDuration = selectedDurations[vrCellKey] ?? defaultTier?.duration_min ?? 60;
                        const isInitiating = initiatingCell === vrCellKey;

                        return (
                          <td
                            colSpan={stations.length}
                            ref={(el) => {
                              cellRefs.current[vrCellKey] = el;
                            }}
                            className={`p-3.5 sm:p-5 align-top transition-all duration-300 relative bg-[#FFFFFF] ${
                              isFocused ? 'ring-2 ring-[#EA580C] bg-[#FFF7ED] z-20 shadow-xl' : ''
                            }`}
                          >
                            {hasVrSession && vrActiveSession ? (
                              /* STATE A: VR RIG ACTIVE */
                              <div className="p-4 sm:p-5 rounded-2xl bg-[#FFFFFF] border border-[#BBF7D0] shadow-sm relative overflow-hidden space-y-4">
                                <div className="absolute top-0 left-0 right-0 h-1 bg-[#15803D]" />

                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-center">
                                  {/* 1. Player Info */}
                                  <div className="space-y-2">
                                    <div className="flex items-center gap-2">
                                      <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-bold font-mono-code uppercase bg-[#DCFCE7] text-[#15803D] border border-[#BBF7D0]">
                                        <Radio className="w-3 h-3 animate-pulse text-[#15803D]" />
                                        <span>VR Rig Active</span>
                                      </span>
                                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono-code font-bold bg-[#EFF6FF] text-[#1E40AF] border border-[#BFDBFE]">
                                        Station: VR1
                                      </span>
                                    </div>

                                    <div>
                                      <span className="text-base font-black text-[#0F172A] font-display block">
                                        {vrActiveSession.customer_name}
                                      </span>
                                      {vrActiveSession.customer_phone && (
                                        <span className="text-xs text-[#64748B] font-mono-code flex items-center gap-1.5 mt-1 font-semibold">
                                          <Phone className="w-3 h-3 text-[#EA580C]" />
                                          <span>{vrActiveSession.customer_phone}</span>
                                        </span>
                                      )}
                                    </div>

                                    <div className="text-[11px] text-[#64748B] font-mono-code">
                                      Started: {new Date(vrActiveSession.started_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}
                                    </div>
                                  </div>

                                  {/* 2. Live Countdown Timer & Progress */}
                                  {(() => {
                                    const countdown = formatLiveCountdown(
                                      vrActiveSession.started_at,
                                      vrActiveSession.allocated_minutes
                                    );
                                    return (
                                      <div className="p-3.5 rounded-xl bg-[#FFF7ED] border border-[#FED7AA]/60 space-y-2 text-center">
                                        <div className="flex items-center justify-between text-xs text-[#64748B]">
                                          <div className="flex items-center gap-1">
                                            <Timer className="w-3.5 h-3.5 text-[#15803D]" />
                                            <span className="font-semibold text-[11px]">Time Left:</span>
                                          </div>
                                          <span className="font-mono-code text-[11px]">{vrActiveSession.allocated_minutes}m booked</span>
                                        </div>

                                        <div className={`text-2xl font-black font-mono-code ${countdown.isOvertime ? 'text-[#B91C1C] animate-pulse' : 'text-[#15803D]'}`}>
                                          {countdown.remainingStr}
                                        </div>

                                        <div className="w-full bg-[#E2E8F0] h-2 rounded-full overflow-hidden">
                                          <div
                                            className={`h-full transition-all duration-1000 ${countdown.isOvertime ? 'bg-[#B91C1C]' : 'bg-[#15803D]'}`}
                                            style={{ width: `${countdown.progressPercent}%` }}
                                          />
                                        </div>

                                        <div className="text-[11px] text-[#64748B] font-mono-code">
                                          Elapsed: {countdown.elapsedStr}
                                        </div>
                                      </div>
                                    );
                                  })()}

                                  {/* 3. Financials & Actions */}
                                  <div className="space-y-3">
                                    <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
                                      <span className="text-xs text-[#64748B] font-medium">Running Total:</span>
                                      <span className="text-base font-black font-mono-code text-[#172554]">
                                        ₹{Number(vrActiveSession.running_total || vrActiveSession.time_charge || 0).toFixed(2)}
                                      </span>
                                    </div>

                                    <div className="flex items-center gap-2">
                                      <button
                                        onClick={() => onOrderFood(vrActiveSession, 'VR1')}
                                        className="flex-1 py-2 px-2.5 rounded-xl bg-[#FFF7ED] hover:bg-[#FFEDD5] border border-[#FED7AA] text-[#EA580C] font-bold text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                                      >
                                        <UtensilsCrossed className="w-3.5 h-3.5 text-[#EA580C]" />
                                        <span>Order Food</span>
                                      </button>

                                      <button
                                        onClick={() => onCheckout(vrActiveSession, 'VR1')}
                                        className="flex-1 py-2 px-2.5 rounded-xl bg-[#172554] hover:bg-[#1E3A8A] text-[#FFFFFF] font-bold text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                                      >
                                        <Receipt className="w-3.5 h-3.5 text-white" />
                                        <span>Settle Bill</span>
                                      </button>
                                    </div>

                                    {/* Quick extend buttons */}
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[10px] text-[#64748B] font-bold uppercase shrink-0">Extend:</span>
                                      <button
                                        disabled={extendingSessionId === vrActiveSession.session_id}
                                        onClick={() => handleExtend(vrActiveSession, 30)}
                                        className="flex-1 py-1 px-2 rounded-xl bg-[#FFFFFF] hover:bg-[#F8FAFC] border border-[#E2E8F0] text-[#0F172A] font-bold text-[10px] transition-all flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
                                      >
                                        <PlusCircle className="w-3 h-3 text-[#15803D]" />
                                        <span>+30m</span>
                                      </button>
                                      <button
                                        disabled={extendingSessionId === vrActiveSession.session_id}
                                        onClick={() => handleExtend(vrActiveSession, 60)}
                                        className="flex-1 py-1 px-2 rounded-xl bg-[#FFFFFF] hover:bg-[#F8FAFC] border border-[#E2E8F0] text-[#0F172A] font-bold text-[10px] transition-all flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
                                      >
                                        <PlusCircle className="w-3 h-3 text-[#15803D]" />
                                        <span>+1h</span>
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              /* STATE B: VR RIG AVAILABLE / CHECK-IN */
                              <div className="p-4 sm:p-5 rounded-2xl bg-[#FFFFFF] border border-[#E2E8F0] shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                                {/* Left: Dedicated Rig Info */}
                                <div className="space-y-2.5 max-w-sm">
                                  <div className="flex items-center gap-2">
                                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold font-mono-code uppercase bg-[#DCFCE7] text-[#15803D] border border-[#BBF7D0]">
                                      <CheckCircle2 className="w-3.5 h-3.5" />
                                      <span>VR Rig: READY</span>
                                    </span>
                                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono-code font-bold bg-[#EFF6FF] text-[#1E40AF] border border-[#BFDBFE]">
                                      Station: VR1
                                    </span>
                                  </div>

                                  <div>
                                    <h4 className="text-base font-black text-[#172554] font-display">
                                      Dedicated Virtual Reality Rig (VR1)
                                    </h4>
                                    <p className="text-xs text-[#64748B] mt-1 leading-relaxed">
                                      High-performance tethered PC-VR headset with room-scale 6DoF tracking and 4K optics. Standalone gaming rig decoupled from PS consoles.
                                    </p>
                                  </div>

                                  <div className="flex flex-wrap items-center gap-2 pt-1">
                                    <span className="px-2.5 py-1 rounded-lg text-[10px] font-mono-code font-semibold bg-[#FFF7ED] text-[#EA580C] border border-[#FED7AA]">
                                      Room-Scale 6DoF
                                    </span>
                                    <span className="px-2.5 py-1 rounded-lg text-[10px] font-mono-code font-semibold bg-[#F8FAFC] text-[#64748B] border border-[#E2E8F0]">
                                      Meta Quest 3 / PC-VR
                                    </span>
                                  </div>
                                </div>

                                {/* Right: Check-In Form */}
                                <div className="flex-1 max-w-lg bg-[#FFF7ED]/40 p-4 sm:p-5 rounded-2xl border border-[#FED7AA]/60 space-y-3">
                                  {/* Inputs */}
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                    <div>
                                      <label className="text-[10px] uppercase text-[#64748B] font-bold block mb-1">
                                        CUSTOMER NAME:
                                      </label>
                                      <input
                                        type="text"
                                        placeholder="Walk-in Gamer"
                                        value={customerNames[vrCellKey] || ''}
                                        onChange={(e) =>
                                          setCustomerNames((prev) => ({
                                            ...prev,
                                            [vrCellKey]: e.target.value,
                                          }))
                                        }
                                        className="w-full px-3 py-2 rounded-xl bg-[#FFFFFF] border border-[#E2E8F0] text-xs text-[#0F172A] placeholder-[#94A3B8] focus:outline-none focus:border-[#EA580C] transition-colors shadow-xs"
                                      />
                                    </div>
                                    <div>
                                      <label className="text-[10px] uppercase text-[#64748B] font-bold block mb-1">
                                        PHONE NUMBER (OPTIONAL):
                                      </label>
                                      <input
                                        type="tel"
                                        placeholder="10-digit Phone"
                                        maxLength={10}
                                        value={customerPhones[vrCellKey] || ''}
                                        onChange={(e) =>
                                          setCustomerPhones((prev) => ({
                                            ...prev,
                                            [vrCellKey]: e.target.value.replace(/\D/g, '').slice(0, 10),
                                          }))
                                        }
                                        className="w-full px-3 py-2 rounded-xl bg-[#FFFFFF] border border-[#E2E8F0] text-xs text-[#0F172A] placeholder-[#94A3B8] focus:outline-none focus:border-[#EA580C] font-mono transition-colors shadow-xs"
                                      />
                                    </div>
                                  </div>

                                  {/* Duration Selector & Start Button */}
                                  <div className="flex flex-col sm:flex-row sm:items-end gap-3 pt-0.5">
                                    <div className="flex-1 space-y-1.5">
                                      <label className="text-[10px] uppercase text-[#64748B] font-bold block">
                                        Select Duration:
                                      </label>
                                      <div className="grid grid-cols-3 gap-1.5">
                                        {vrPricingTiers.map((tier) => {
                                          const isSelected = selectedDuration === tier.duration_min;
                                          return (
                                            <button
                                              key={tier.duration_min}
                                              type="button"
                                              onClick={() =>
                                                setSelectedDurations((prev) => ({
                                                  ...prev,
                                                  [vrCellKey]: tier.duration_min,
                                                }))
                                              }
                                              className={`py-2 px-1.5 rounded-xl text-center transition-all font-display border cursor-pointer ${
                                                isSelected
                                                  ? 'bg-[#EA580C] border-[#EA580C] text-[#FFFFFF] shadow-sm'
                                                  : 'bg-[#FFFFFF] border-[#E2E8F0] text-[#64748B] hover:text-[#0F172A] hover:border-[#CBD5E1]'
                                              }`}
                                            >
                                              <div className={`text-xs font-bold tracking-tight ${isSelected ? 'text-white' : 'text-[#0F172A]'}`}>
                                                {tier.label || `${tier.duration_min}m`}
                                              </div>
                                              <div className={`text-[10px] font-bold ${isSelected ? 'text-white/90' : 'text-[#172554]'}`}>
                                                ₹{Number(tier.price).toFixed(0)}
                                              </div>
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>

                                    <button
                                      disabled={isInitiating}
                                      onClick={() =>
                                        startSessionMutation.mutate({
                                          stationId: 'VR1',
                                          modeId: mode.id,
                                          durationMinutes: selectedDuration,
                                          modeName: mode.name,
                                          customerName: customerNames[vrCellKey],
                                          customerPhone: customerPhones[vrCellKey],
                                        })
                                      }
                                      className="sm:w-44 py-3 px-3 rounded-xl bg-[#172554] hover:bg-[#1E3A8A] text-[#FFFFFF] font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 shadow-sm active:scale-98 cursor-pointer disabled:opacity-50 shrink-0"
                                    >
                                      {isInitiating ? (
                                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                      ) : (
                                        <>
                                          <Play className="w-3.5 h-3.5 fill-current" />
                                          <span>Start VR</span>
                                        </>
                                      )}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )}
                          </td>
                        );
                      }

                      return stations.map((station) => {
                        // Effective Station & Session details
                        const effectiveStationId = station.id;
                        const effectiveStationName = station.name;
                        const cellKey = `${mode.id}-${effectiveStationId}`;
                        const isFocused = focusedCellKey === cellKey;
                        const activeSession = station.active_session;
                        const hasActiveSession = !!activeSession;

                        // Check if supported hardware
                        const isSupportedHardware = mode.supported_stations.some(
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
                          className={`p-3.5 sm:p-4 border-r last:border-r-0 border-[#E2E8F0] align-top transition-all duration-300 relative ${
                            flashingStationId === station.name.toUpperCase() ? 'bg-[#FFEDD5]/40' : ''
                          } ${
                            isFocused
                              ? 'ring-2 ring-[#EA580C] bg-[#FFF7ED] scale-[1.01] z-20 shadow-xl'
                              : ''
                          }`}
                        >
                          {/* ========================================================================= */}
                          {/* STATE A: ACTIVE HERE */}
                          {/* ========================================================================= */}
                          {isStateA && activeSession && (
                            <div className="p-3.5 rounded-2xl bg-[#FFFFFF] border border-[#BBF7D0] shadow-sm space-y-3 relative overflow-hidden">
                              {/* Glowing top line */}
                              <div className="absolute top-0 left-0 right-0 h-1 bg-[#15803D]" />

                              {/* Customer Header & Active Pill */}
                              <div className="flex items-center justify-between gap-1.5 pt-1">
                                <div className="truncate">
                                  <span className="text-xs font-black text-[#0F172A] font-display truncate block">
                                    {activeSession.customer_name}
                                  </span>
                                  {activeSession.customer_phone && (
                                    <span className="text-[10px] font-mono-code text-[#64748B] font-medium flex items-center gap-1">
                                      <span>📞</span>
                                      <span>{activeSession.customer_phone}</span>
                                    </span>
                                  )}
                                </div>
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-[#DCFCE7] text-[#15803D] border border-[#BBF7D0]">
                                  <Radio className="w-2.5 h-2.5 animate-pulse text-[#15803D]" />
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
                                  <div className="p-2.5 rounded-xl bg-[#FFF7ED] border border-[#E2E8F0] space-y-1.5">
                                    <div className="flex items-center justify-between text-xs">
                                      <div className="flex items-center gap-1.5 text-[#64748B]">
                                        <Timer className="w-3.5 h-3.5 text-[#15803D]" />
                                        <span className="text-[11px] font-medium">Time Left:</span>
                                      </div>
                                      <span
                                        className={`font-black text-sm font-mono-code ${
                                          countdown.isOvertime ? 'text-[#B91C1C] animate-pulse' : 'text-[#15803D]'
                                        }`}
                                      >
                                        {countdown.remainingStr}
                                      </span>
                                    </div>

                                    {/* Progress Bar */}
                                    <div className="w-full bg-[#E2E8F0] rounded-full h-1.5 overflow-hidden">
                                      <div
                                        className={`h-full transition-all duration-1000 ${
                                          countdown.isOvertime
                                            ? 'bg-[#B91C1C]'
                                            : 'bg-[#15803D]'
                                        }`}
                                        style={{ width: `${countdown.progressPercent}%` }}
                                      />
                                    </div>

                                    <div className="flex items-center justify-between text-[10px] text-[#64748B]">
                                      <span>Elapsed: {countdown.elapsedStr}</span>
                                      <span>Booked: {activeSession.allocated_minutes}m</span>
                                    </div>
                                  </div>
                                );
                              })()}

                              {/* 1.5 Active Session Card Embed: In-Seat Food Orders Accordion / Quick List */}
                              {(() => {
                                const kitchenOrders = queryClient.getQueryData<Order[]>(['kitchen-orders']) || [];
                                const sessionOrders = inSeatOrders.filter((o) => {
                                  if (o.stationId.toUpperCase() !== effectiveStationName.toUpperCase()) return false;
                                  // Exclude cancelled / rejected orders
                                  const ordStatus = String(o.status || '').toLowerCase();
                                  if (ordStatus === 'cancelled') return false;
                                  const isCancelledInKitchen = kitchenOrders.some(
                                    (k) => (k.id === o.orderId || (k as any).order_id === o.orderId) && k.status === 'CANCELLED'
                                  );
                                  if (isCancelledInKitchen) return false;
                                  if (!o.mode) return true;
                                  const ordMode = o.mode.toLowerCase();
                                  const curMode = mode.id.toLowerCase();
                                  if (ordMode === curMode) return true;
                                  if (curMode === 'car_sim' && (ordMode.includes('car') || ordMode === 'car_sim')) return true;
                                  if (curMode === 'multiplayer' && (ordMode.includes('multi') || ordMode === 'multiplayer')) return true;
                                  if (curMode === 'solo' && ordMode === 'solo') return true;
                                  return false;
                                });

                                if (sessionOrders.length === 0) return null;

                                return (
                                  <div className="p-2.5 rounded-xl bg-[#FFF7ED] border border-[#FED7AA] space-y-2">
                                    <div className="flex items-center justify-between text-xs pb-1.5 border-b border-[#FED7AA]">
                                      <div className="flex items-center gap-1.5 font-bold text-[#EA580C] font-display">
                                        <UtensilsCrossed className="w-3.5 h-3.5 text-[#EA580C]" />
                                        <span>In-Seat Orders ({sessionOrders.length})</span>
                                      </div>
                                      <span className="text-[10px] text-[#EA580C] bg-[#FFEDD5] px-1.5 py-0.5 rounded border border-[#FED7AA] font-bold">
                                        {sessionOrders.filter((o) => o.status === 'pending').length} pending
                                      </span>
                                    </div>

                                    <div className="space-y-2">
                                      {sessionOrders.map((ord) => {
                                        const isExpanded = !!expandedOrdersMap[ord.orderId];
                                        const itemSummaryStr = ord.items.map((i) => `${i.qty}x ${i.name}`).join(', ');

                                        return (
                                          <div
                                            key={ord.orderId}
                                            className="p-2 rounded-lg bg-[#FFFFFF] border border-[#E2E8F0] space-y-1.5 text-[11px] shadow-xs"
                                          >
                                            {/* Header: Customer Name & Status Toggle */}
                                            <div className="flex items-center justify-between gap-1.5">
                                              <span className="font-bold text-[#0F172A] truncate flex items-center gap-1">
                                                <span className="text-[#64748B] text-[10px]">Gamer:</span>
                                                <span className="text-[#0F172A] truncate font-display">{ord.customerName}</span>
                                              </span>

                                              {/* Status Toggle Button (Pending ➔ Preparing ➔ Delivered) */}
                                              <button
                                                type="button"
                                                onClick={() => handleToggleOrderStatus(ord.orderId, ord.status)}
                                                title="Click to advance order status: Pending ➔ Preparing ➔ Delivered"
                                                className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase transition-all border cursor-pointer ${
                                                  ord.status === 'pending'
                                                    ? 'bg-[#FFEDD5] text-[#C2410C] border-[#FED7AA] hover:bg-[#FED7AA]'
                                                    : ord.status === 'preparing'
                                                    ? 'bg-[#EFF6FF] text-[#1E3A8A] border-[#BFDBFE] hover:bg-[#DBEAFE]'
                                                    : 'bg-[#DCFCE7] text-[#15803D] border-[#BBF7D0] hover:bg-[#BBF7D0]'
                                                }`}
                                              >
                                                ● {ord.status}
                                              </button>
                                            </div>

                                            {/* Item Summary line */}
                                            <p className="text-[10px] text-[#64748B] truncate">
                                              {itemSummaryStr}
                                            </p>

                                            {/* Expand / Collapse Button & Price */}
                                            <div className="flex items-center justify-between pt-1 border-t border-[#E2E8F0] text-[10px]">
                                              <span className="font-bold text-[#172554] font-mono-code">
                                                ₹{ord.totalAmount.toFixed(2)}
                                              </span>
                                              <button
                                                type="button"
                                                onClick={() => toggleOrderExpand(ord.orderId)}
                                                className="flex items-center gap-0.5 text-[#64748B] hover:text-[#0F172A] cursor-pointer"
                                              >
                                                <span>{isExpanded ? 'Hide Items' : 'View Bill'}</span>
                                                {isExpanded ? (
                                                  <ChevronUp className="w-3 h-3" />
                                                ) : (
                                                  <ChevronDown className="w-3 h-3" />
                                                )}
                                              </button>
                                            </div>

                                            {/* Expandable Itemized Bill */}
                                            {isExpanded && (
                                              <div className="pt-1.5 space-y-1 border-t border-[#E2E8F0] text-[10px]">
                                                {ord.items.map((it, idx) => (
                                                  <div key={idx} className="flex justify-between text-[#0F172A]">
                                                    <span>
                                                      {it.name} <span className="text-[#EA580C] font-bold">x{it.qty}</span>
                                                    </span>
                                                    <span className="font-mono-code font-medium">₹{(it.price * it.qty).toFixed(2)}</span>
                                                  </div>
                                                ))}
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              })()}

                              {/* 2. Billing Metrics: Play Charges, Snack Charges, Total Billable Amount */}
                              <div className="p-2.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] space-y-1 text-[11px]">
                                <div className="flex justify-between text-[#64748B]">
                                  <span>Play Charges:</span>
                                  <span className="text-[#0F172A] font-bold font-mono-code">
                                    ₹{Number(activeSession.time_charge || 0).toFixed(2)}
                                  </span>
                                </div>
                                <div className="flex justify-between text-[#64748B]">
                                  <span>Snack Charges:</span>
                                  <span className="text-[#0F172A] font-bold font-mono-code">
                                    ₹{Number(activeSession.orders_charge || 0).toFixed(2)}
                                  </span>
                                </div>
                                <div className="flex justify-between font-bold text-[#0F172A] pt-1 border-t border-[#E2E8F0]">
                                  <span className="text-[#172554]">Total Billable:</span>
                                  <span className="text-[#172554] font-black text-xs font-mono-code">
                                    ₹{Number(activeSession.running_total || 0).toFixed(2)}
                                  </span>
                                </div>
                              </div>

                              {/* 3. Action Buttons: Order Food & Drinks, Generate Bill & Checkout, Transfer, +30m, +1h */}
                              <div className="space-y-1.5 pt-1">
                                {/* Order Food & Drinks */}
                                <button
                                  onClick={() => onOrderFood(activeSession, effectiveStationName)}
                                  className="w-full py-2 px-2.5 rounded-xl bg-[#FFF7ED] hover:bg-[#FFEDD5] border border-[#FED7AA] text-[#EA580C] font-bold text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                                >
                                  <UtensilsCrossed className="w-3.5 h-3.5 text-[#EA580C]" />
                                  <span>Order Food &amp; Drinks</span>
                                </button>

                                {/* Generate Bill & Checkout */}
                                <button
                                  onClick={() => onCheckout(activeSession, effectiveStationName)}
                                  className="w-full py-2 px-2.5 rounded-xl bg-[#172554] hover:bg-[#1E3A8A] text-[#FFFFFF] font-bold text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                                >
                                  <Receipt className="w-3.5 h-3.5 text-white" />
                                  <span>Generate Bill &amp; Checkout</span>
                                </button>

                                {/* Action Buttons Row: Transfer, +30m, +1h */}
                                <div className="grid grid-cols-3 gap-1.5 pt-0.5">
                                  <button
                                    onClick={() => onTransfer(activeSession, effectiveStationName)}
                                    className="py-1.5 px-2 rounded-xl bg-[#EFF6FF] hover:bg-[#DBEAFE] border border-[#BFDBFE] text-[#172554] font-bold text-[10px] transition-all flex items-center justify-center gap-1 cursor-pointer"
                                    title="Transfer player to another station"
                                  >
                                    <ArrowRightLeft className="w-3 h-3 text-[#172554]" />
                                    <span>Transfer</span>
                                  </button>

                                  <button
                                    disabled={extendingSessionId === activeSession.session_id}
                                    onClick={() => handleExtend(activeSession, 30)}
                                    className="py-1.5 px-2 rounded-xl bg-[#FFFFFF] hover:bg-[#F8FAFC] border border-[#E2E8F0] text-[#0F172A] font-bold text-[10px] transition-all flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
                                    title="Add 30 minutes to this session"
                                  >
                                    <PlusCircle className="w-3 h-3 text-[#15803D]" />
                                    <span>+30m</span>
                                  </button>

                                  <button
                                    disabled={extendingSessionId === activeSession.session_id}
                                    onClick={() => handleExtend(activeSession, 60)}
                                    className="py-1.5 px-2 rounded-xl bg-[#FFFFFF] hover:bg-[#F8FAFC] border border-[#E2E8F0] text-[#0F172A] font-bold text-[10px] transition-all flex items-center justify-center gap-1 cursor-pointer disabled:opacity-50"
                                    title="Add 1 hour to this session"
                                  >
                                    <PlusCircle className="w-3 h-3 text-[#15803D]" />
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
                            <div className="p-3.5 rounded-2xl bg-[#FFFFFF] border border-[#E2E8F0] shadow-xs space-y-3">
                              {/* Station Availability Status */}
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-[#15803D] font-bold">
                                  {isVrRow ? 'VR Rig Ready: READY' : 'Console Free: READY'}
                                </span>
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-[#DCFCE7] text-[#15803D] border border-[#BBF7D0]">
                                  <CheckCircle2 className="w-2.5 h-2.5" />
                                  <span>READY</span>
                                </span>
                              </div>

                              {/* Customer Name & Phone Number Inputs */}
                              <div className="space-y-2">
                                <div>
                                  <label className="text-[10px] uppercase text-[#64748B] font-bold block mb-1">
                                    CUSTOMER NAME:
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
                                    className="w-full px-2.5 py-1.5 rounded-xl bg-[#FFF7ED] border border-[#E2E8F0] text-xs text-[#0F172A] placeholder-[#94A3B8] focus:outline-none focus:border-[#EA580C] transition-colors"
                                  />
                                </div>
                                <div>
                                  <label className="text-[10px] uppercase text-[#64748B] font-bold block mb-1">
                                    PHONE NUMBER (OPTIONAL):
                                  </label>
                                  <input
                                    type="tel"
                                    placeholder="10-digit Phone"
                                    maxLength={10}
                                    value={customerPhones[cellKey] || ''}
                                    onChange={(e) =>
                                      setCustomerPhones((prev) => ({
                                        ...prev,
                                        [cellKey]: e.target.value.replace(/\D/g, '').slice(0, 10),
                                      }))
                                    }
                                    className="w-full px-2.5 py-1.5 rounded-xl bg-[#FFF7ED] border border-[#E2E8F0] text-xs text-[#0F172A] placeholder-[#94A3B8] focus:outline-none focus:border-[#EA580C] font-mono transition-colors"
                                  />
                                </div>
                              </div>

                              {/* Duration Selector Buttons: [30 mins], [1 hr], [2 hrs] */}
                              <div className="space-y-1.5">
                                <div className="text-[10px] uppercase text-[#64748B] font-bold">
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
                                            ? 'bg-[#EA580C] border-[#EA580C] text-[#FFFFFF] shadow-sm'
                                            : 'bg-[#FFFFFF] border-[#E2E8F0] text-[#64748B] hover:text-[#0F172A] hover:border-[#CBD5E1]'
                                        }`}
                                      >
                                        <div className={`text-[11px] font-bold tracking-tight ${isSelected ? 'text-white' : 'text-[#0F172A]'}`}>
                                          {tier.label || `${tier.duration_min}m`}
                                        </div>
                                        <div className={`text-[10px] font-bold ${isSelected ? 'text-white/90' : 'text-[#172554]'}`}>
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
                                    customerPhone: customerPhones[cellKey],
                                  })
                                }
                                className="w-full py-2.5 px-3 rounded-xl bg-[#172554] hover:bg-[#1E3A8A] text-[#FFFFFF] font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 shadow-sm active:scale-98 cursor-pointer disabled:opacity-50"
                              >
                                {isInitiating ? (
                                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                ) : (
                                  <>
                                    <Play className="w-3.5 h-3.5 fill-current" />
                                    <span>▶ START {mode.name.toUpperCase()}</span>
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
                              className="p-3.5 rounded-2xl bg-[#F8FAFC] border border-[#E2E8F0] opacity-80 hover:opacity-100 hover:border-[#172554]/50 transition-all duration-200 cursor-pointer space-y-2.5 group"
                              title={`Click to focus active session on ${activeSession.mode_name}`}
                            >
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-[#64748B] font-medium">Console In Use</span>
                                <Lock className="w-3.5 h-3.5 text-[#64748B] group-hover:text-[#172554] transition-colors" />
                              </div>

                              {/* Status Pill: "Active in [Other Mode]" */}
                              <div className="p-2.5 rounded-xl bg-[#FFFFFF] border border-[#E2E8F0] group-hover:border-[#172554]/40 transition-colors space-y-1.5">
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-[#EFF6FF] text-[#1E3A8A] border border-[#BFDBFE]">
                                  <span>Active in {activeSession.mode_name}</span>
                                </span>

                                <p className="text-[11px] text-[#64748B] truncate">
                                  Player: <strong className="text-[#0F172A]">{activeSession.customer_name}</strong>
                                  {activeSession.customer_phone && (
                                    <span className="ml-1 text-[#64748B] font-mono font-medium">({activeSession.customer_phone})</span>
                                  )}
                                </p>
                              </div>

                              {/* Quick link to focus active cell */}
                              <div className="flex items-center justify-center gap-1 text-[11px] text-[#172554] font-semibold group-hover:text-[#1E3A8A] pt-0.5">
                                <span>Focus Active Session</span>
                                <ExternalLink className="w-3 h-3" />
                              </div>
                            </div>
                          )}

                          {/* Hardware Incompatible Fallback */}
                          {!isSupportedHardware && (
                            <div className="p-3.5 rounded-2xl bg-[#F8FAFC] border border-dashed border-[#E2E8F0] opacity-60 space-y-2 flex flex-col items-center justify-center text-center select-none">
                              <ShieldAlert className="w-5 h-5 text-[#94A3B8]" />
                              <div className="text-[10px] uppercase text-[#94A3B8] font-bold">
                                Rig Incompatible
                              </div>
                              <p className="text-[10px] text-[#94A3B8]">
                                {mode.name} requires {mode.supported_stations.join(', ')}
                              </p>
                            </div>
                          )}
                        </td>
                      );
                    });
                  })()}
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
