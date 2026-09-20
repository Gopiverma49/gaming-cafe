import { PricingTier } from './types';

// ---------------------------------------------------------------------------
// Real-time Query Polling Intervals (in milliseconds)
// ---------------------------------------------------------------------------
export const POLL_INTERVALS = {
  STATIONS: 6000,
  ORDERS: 8000,
  CUSTOMERS: 8000,
  MENU: 8000,
  KITCHEN_BADGE: 12000,
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
  color: string;
  dot: string;
  status: StockStatusType;
}

export function evaluateStockStatus(stock: number): StockStatusInfo {
  if (stock <= STOCK_LEVEL.CRITICAL) {
    return {
      label: 'Critical',
      color: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
      dot: 'bg-rose-500 animate-pulse',
      status: 'CRITICAL',
    };
  }
  if (stock <= STOCK_LEVEL.MODERATE) {
    return {
      label: 'Moderate',
      color: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
      dot: 'bg-amber-400',
      status: 'MODERATE',
    };
  }
  return {
    label: 'Enough',
    color: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    dot: 'bg-emerald-400',
    status: 'ENOUGH',
  };
}

// ---------------------------------------------------------------------------
// Standard Default Pricing Slabs
// ---------------------------------------------------------------------------
export const DEFAULT_PRICING_TIERS: PricingTier[] = [
  { duration_min: 30, price: 100, label: '30 mins' },
  { duration_min: 60, price: 180, label: '1 hr' },
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

export function getStationTierVisuals(tier: string): TierVisualInfo {
  switch (tier.toUpperCase()) {
    case 'CONSOLE':
      return {
        label: 'PS5 Console',
        badge: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
        display: '65″ 4K 120Hz OLED + DualSense',
        accentColor: 'text-blue-400',
      };
    case 'SIMULATOR':
      return {
        label: 'Simulator Rig',
        badge: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
        display: 'Triple 32″ Curved + DirectDrive',
        accentColor: 'text-amber-400',
      };
    case 'VIP':
      return {
        label: 'VIP Station',
        badge: 'bg-fuchsia-500/10 text-fuchsia-400 border-fuchsia-500/20',
        display: 'Private Acoustic Pod + RTX 4090',
        accentColor: 'text-fuchsia-400',
      };
    default:
      return {
        label: 'Gaming PC',
        badge: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
        display: '240Hz Fast IPS + RTX 4080',
        accentColor: 'text-cyan-400',
      };
  }
}
