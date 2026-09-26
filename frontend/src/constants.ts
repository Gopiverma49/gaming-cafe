import { PricingTier } from './types';

// ---------------------------------------------------------------------------
// Real-time Query Polling Intervals (in milliseconds)
// WebSocket and mutation cache invalidations provide instant real-time sync.
// These intervals serve as a gentle, low-overhead fallback.
// ---------------------------------------------------------------------------
export const POLL_INTERVALS = {
  STATIONS: 4000,
  ORDERS: 5000,
  CUSTOMERS: 10000,
  MENU: 30000,
  KITCHEN_BADGE: 10000,
} as const;

// ---------------------------------------------------------------------------
// Inventory Stock Evaluation Thresholds
// ---------------------------------------------------------------------------
export const STOCK_LEVEL = {
  CRITICAL: 5,
  MODERATE: 15,
} as const;

export type StockStatusType = 'CRITICAL' | 'MODERATE' | 'ENOUGH';

export interface StockStatusInfo {
  label: string;
  /** Hex background color for the badge */
  bg: string;
  /** Hex text color for the badge */
  fg: string;
  /** Hex border color for the badge */
  border: string;
  /** Whether to show a pulsing dot */
  pulse: boolean;
  status: StockStatusType;
  /** @deprecated Use bg/fg/border instead of Tailwind class strings */
  color: string;
  /** @deprecated Use pulse flag instead */
  dot: string;
}

export function evaluateStockStatus(stock: number | null | undefined): StockStatusInfo {
  const safeStock = typeof stock === 'number' && !isNaN(stock) ? stock : 0;
  if (safeStock <= STOCK_LEVEL.CRITICAL) {
    return {
      label: 'Critical',
      bg: '#FEF2F2',
      fg: '#B91C1C',
      border: '#FECACA',
      pulse: true,
      status: 'CRITICAL',
      // legacy compat
      color: 'bg-rose-50 text-rose-700 border-rose-200',
      dot: 'bg-rose-500 animate-pulse',
    };
  }
  if (safeStock <= STOCK_LEVEL.MODERATE) {
    return {
      label: 'Moderate',
      bg: '#FFFBEB',
      fg: '#B45309',
      border: '#FDE68A',
      pulse: false,
      status: 'MODERATE',
      color: 'bg-amber-50 text-amber-700 border-amber-200',
      dot: 'bg-amber-400',
    };
  }
  return {
    label: 'Enough',
    bg: '#F0FDF4',
    fg: '#15803D',
    border: '#BBF7D0',
    pulse: false,
    status: 'ENOUGH',
    color: 'bg-green-50 text-green-700 border-green-200',
    dot: 'bg-green-400',
  };
}

// ---------------------------------------------------------------------------
// Standard Default Pricing Slabs & Rates
// ---------------------------------------------------------------------------
export const DEFAULT_HOURLY_RATE = 180;

export const DEFAULT_PRICING_TIERS: PricingTier[] = [
  { duration_min: 30, price: 100, label: '30 mins' },
  { duration_min: 60, price: DEFAULT_HOURLY_RATE, label: '1 hr' },
  { duration_min: 120, price: 320, label: '2 hrs' },
];

// ---------------------------------------------------------------------------
// Station Platform Tier Visuals & Specs
// ---------------------------------------------------------------------------
export interface TierVisualInfo {
  label: string;
  badge: string;
  display: string;
  accentColor: string;
}

export function getStationTierVisuals(tier?: string | null): TierVisualInfo {
  const safeTier = (tier || 'CONSOLE').toString().toUpperCase();
  switch (safeTier) {
    case 'CONSOLE':
      return {
        label: 'PS5 Console',
        badge: 'bg-blue-50 text-blue-700 border-blue-200',
        display: '65″ 4K 120Hz OLED + DualSense',
        accentColor: 'text-blue-700',
      };
    case 'SIMULATOR':
      return {
        label: 'Simulator Rig',
        badge: 'bg-amber-50 text-amber-700 border-amber-200',
        display: 'Triple 32″ Curved + DirectDrive',
        accentColor: 'text-amber-700',
      };
    case 'VIP':
      return {
        label: 'VIP Station',
        badge: 'bg-purple-50 text-purple-700 border-purple-200',
        display: 'Private Acoustic Pod + RTX 4090',
        accentColor: 'text-purple-700',
      };
    default:
      return {
        label: 'Gaming PC',
        badge: 'bg-sky-50 text-sky-700 border-sky-200',
        display: '240Hz Fast IPS + RTX 4080',
        accentColor: 'text-sky-700',
      };
  }
}

