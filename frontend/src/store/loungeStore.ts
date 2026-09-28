import { create } from 'zustand';
import { playOrderChime } from '../utils/soundAlerts';
import { sortBookingsUpcomingWise } from '../utils/bookingConflict';

export { playOrderChime };

export interface AdvanceBooking {
  bookingId: string;
  id?: string;
  customerName: string;
  phoneNumber?: string;
  customerPhone?: string; // legacy support
  stationId: string;
  stationName?: string;
  sessionMode: 'Solo' | 'Multiplayer' | string;
  bookingDate: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  durationMinutes: number;
  endTime: string; // HH:mm
  advancePaid: number;
  totalAmount: number;
  remainingBalance: number;
  status: 'CONFIRMED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  bookingType?: string;
  scheduledTime?: string;
  hourlyRate?: number;
  totalCost?: number;
  createdAt?: string;
}

export interface OrderedFoodItem {
  id: string;
  name: string;
  category: string;
  quantity: number;
  price: number;
  total: number;
  timestamp: string;
}

export interface FinancialRecord {
  id: string;
  stationName: string;
  customerName?: string;
  timeCharge: number;
  foodCharge: number;
  totalAmount: number;
  paymentMethod: 'UPI' | 'CASH';
  timestamp: string;
  dateStr: string; // YYYY-MM-DD
  foodItems?: { name: string; quantity: number; price: number }[];
}

export interface CustomerInSeatOrder {
  orderId: string;
  stationId: 'PS1' | 'PS2' | 'PS3' | string;
  mode?: string;
  customerName: string;
  items: { id: string; name: string; qty: number; price: number }[];
  totalAmount: number;
  status: 'pending' | 'preparing' | 'delivered';
  createdAt: string;
  sessionId?: string;
}

interface LoungeState {
  // In-Seat Customer Orders with Live Status
  inSeatOrders: CustomerInSeatOrder[];
  addInSeatOrder: (order: CustomerInSeatOrder) => void;
  updateInSeatOrderStatus: (orderId: string, status: 'pending' | 'preparing' | 'delivered' | 'cancelled' | string) => void;
  removeInSeatOrder: (orderId: string) => void;
  getStationInSeatOrders: (stationId: string) => CustomerInSeatOrder[];
  clearStationInSeatOrders: (stationId: string, customerName?: string) => void;
  settledCafeCustomers: string[];
  settleCafeCustomer: (customerName: string) => void;
  unsettleCafeCustomer: (customerName: string) => void;
  clearSettledCafeCustomers: () => void;

  // Visual Ping Highlight Station Column
  flashingStationId: string | null;
  triggerStationPing: (stationId: string) => void;
  clearStationPing: () => void;

  // Active Station Food Orders (for Live Bill Breakdown)
  stationFoodOrders: Record<string, OrderedFoodItem[]>;
  addStationFoodOrder: (stationName: string, items: { id: string; name: string; category: string; quantity: number; price: number }[]) => void;
  getStationFoodOrders: (stationName: string) => OrderedFoodItem[];
  clearStationFoodOrders: (stationName: string) => void;

  // Station Games
  stationGames: Record<string, string[]>;
  updateStationGames: (stationId: string, games: string[]) => void;

  // Advance Bookings
  bookings: AdvanceBooking[];
  addBooking: (booking: Partial<AdvanceBooking> & { customerName: string; stationId: string }) => AdvanceBooking;
  updateBooking: (bookingId: string, updates: Partial<AdvanceBooking>) => void;
  cancelBooking: (bookingId: string) => void;
  activateBooking: (bookingId: string) => void;
  completeBooking: (bookingId: string) => void;
  completeActiveBookingForStation: (stationId: string) => void;

  // Completed Financial Records & Revenue Analytics
  financialRecords: FinancialRecord[];
  recordTransaction: (record: Omit<FinancialRecord, 'id' | 'timestamp' | 'dateStr'>) => FinancialRecord;

  // Local Customer Visit Tracker
  recordCustomerVisit: (name: string, phone?: string, spentAmount?: number) => void;
}

const DEFAULT_STATION_GAMES: Record<string, string[]> = {
  PS3: ['EA Sports FC 24 (FIFA)', 'Marvel Spider-Man 2', 'Tekken 8', 'Street Fighter 6', 'Hogwarts Legacy'],
  Solo: ['God of War Ragnarök', 'Ghost of Tsushima', 'Elden Ring', 'Cyberpunk 2077', 'Spider-Man 2'],
  multiplyer: ['EA Sports FC 24 (FIFA)', 'Tekken 8', 'Mortal Kombat 1', 'NBA 2K24', 'Call of Duty: Warzone'],
};

// ---------------------------------------------------------------------------
// High-Speed 0ms Cross-Tab Synchronization Bus
// ---------------------------------------------------------------------------
const syncChannel =
  typeof window !== 'undefined' && 'BroadcastChannel' in window
    ? new BroadcastChannel('vanya_lounge_cross_tab_sync')
    : null;

export function broadcastLoungeSync(type: 'BOOKINGS_SYNC' | 'ORDERS_SYNC', payload: any) {
  if (syncChannel) {
    try {
      syncChannel.postMessage({ type, payload, timestamp: Date.now() });
    } catch {}
  }
}

// Purge legacy localStorage keys on startup so stale mock data is completely eliminated
if (typeof window !== 'undefined' && window.localStorage) {
  try {
    localStorage.removeItem('vanya_lounge_bookings_v2');
    localStorage.removeItem('vanya_lounge_station_orders_v2');
    localStorage.removeItem('vanya_lounge_financial_records_v2');
  } catch {
    // Ignore storage quota / restriction errors
  }
}

export const useLoungeStore = create<LoungeState>((set, get) => ({
  // In-Seat Customer Orders with Live Status
  inSeatOrders: [],

  addInSeatOrder: (order) => {
    // 0. If this customer was previously settled, un-settle them so their new active tab displays
    if (order.customerName) {
      get().unsettleCafeCustomer(order.customerName);
    }

    // 1. Add to inSeatOrders array
    set((state) => {
      const updated = [order, ...state.inSeatOrders.filter((o) => o.orderId !== order.orderId)];
      broadcastLoungeSync('ORDERS_SYNC', updated);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('vanya_sync_invalidate', { detail: { type: 'ORDERS_SYNC', payload: updated } }));
      }
      return { inSeatOrders: updated };
    });

    // 2. Audio & Visual Ping for Admin Station Column
    get().triggerStationPing(order.stationId);
  },

  updateInSeatOrderStatus: (orderId, newStatus) => {
    const s = String(newStatus).toLowerCase();
    const isTerminated = s === 'cancelled' || s === 'rejected';
    const mappedStatus = s === 'served' ? 'delivered' : newStatus;
    set((state) => {
      const updated = isTerminated
        ? state.inSeatOrders.filter((o) => o.orderId !== orderId)
        : state.inSeatOrders.map((o) =>
            o.orderId === orderId ? { ...o, status: mappedStatus as any } : o
          );
      broadcastLoungeSync('ORDERS_SYNC', updated);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('vanya_sync_invalidate', { detail: { type: 'ORDERS_SYNC', payload: updated } }));
      }
      return { inSeatOrders: updated };
    });
  },

  removeInSeatOrder: (orderId) => {
    set((state) => {
      const updated = state.inSeatOrders.filter((o) => o.orderId !== orderId);
      broadcastLoungeSync('ORDERS_SYNC', updated);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('vanya_sync_invalidate', { detail: { type: 'ORDERS_SYNC', payload: updated } }));
      }
      return { inSeatOrders: updated };
    });
  },

  getStationInSeatOrders: (stationId) => {
    const norm = stationId.toUpperCase();
    const isCafeQuery = norm.includes('CAFE');
    return get().inSeatOrders.filter((o) => {
      const s = String(o.status).toLowerCase();
      if (s === 'cancelled' || s === 'rejected') return false;
      const orderSt = o.stationId.toUpperCase();
      if (isCafeQuery) {
        return orderSt.includes('CAFE') || (o.mode && ['dine-in', 'dine-out', 'takeaway'].includes(o.mode.toLowerCase()));
      }
      return orderSt === norm;
    });
  },

  clearStationInSeatOrders: (stationId, customerName) => {
    const norm = stationId.toUpperCase();
    const isCafeQuery = norm.includes('CAFE');
    set((state) => {
      const updated = state.inSeatOrders.filter((o) => {
        const orderSt = o.stationId.toUpperCase();
        if (isCafeQuery) {
          const isCafeOrder = orderSt.includes('CAFE') || (o.mode && ['dine-in', 'dine-out', 'takeaway'].includes(o.mode.toLowerCase()));
          if (!isCafeOrder) return true;
          if (customerName) {
            return o.customerName?.trim().toLowerCase() !== customerName.trim().toLowerCase();
          }
          return false;
        }
        return orderSt !== norm;
      });
      broadcastLoungeSync('ORDERS_SYNC', updated);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('vanya_sync_invalidate', { detail: { type: 'ORDERS_SYNC', payload: updated } }));
      }
      return { inSeatOrders: updated };
    });
  },

  settledCafeCustomers: [],
  settleCafeCustomer: (customerName) => {
    if (!customerName) return;
    const norm = customerName.trim().toLowerCase();
    set((state) => ({
      settledCafeCustomers: state.settledCafeCustomers.includes(norm)
        ? state.settledCafeCustomers
        : [...state.settledCafeCustomers, norm],
      inSeatOrders: state.inSeatOrders.filter((o) => {
        const isCafeOrder = o.stationId.toUpperCase().includes('CAFE') || (o.mode && ['dine-in', 'dine-out', 'takeaway'].includes(o.mode.toLowerCase()));
        if (!isCafeOrder) return true;
        return o.customerName?.trim().toLowerCase() !== norm;
      }),
    }));
  },
  unsettleCafeCustomer: (customerName) => {
    if (!customerName) return;
    const norm = customerName.trim().toLowerCase();
    set((state) => ({
      settledCafeCustomers: state.settledCafeCustomers.filter((n) => n !== norm),
    }));
  },
  clearSettledCafeCustomers: () => set({ settledCafeCustomers: [] }),

  // Flashing Station Column Indicator on New Order
  flashingStationId: null,
  triggerStationPing: (stationId) => {
    playOrderChime();
    set({ flashingStationId: stationId.toUpperCase() });
    setTimeout(() => {
      if (get().flashingStationId === stationId.toUpperCase()) {
        set({ flashingStationId: null });
      }
    }, 4500);
  },
  clearStationPing: () => set({ flashingStationId: null }),

  // Active Station Food Orders (in-memory only; real orders persist to SQLite via API)
  stationFoodOrders: {},

  addStationFoodOrder: (stationName, items) => {
    const rawOrders = get().stationFoodOrders[stationName];
    const currentOrders = Array.isArray(rawOrders) ? rawOrders : [];
    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const newItems: OrderedFoodItem[] = (Array.isArray(items) ? items : []).map((i) => ({
      id: `ord_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      name: i.name,
      category: i.category,
      quantity: i.quantity,
      price: i.price,
      total: i.price * i.quantity,
      timestamp: nowTime,
    }));

    const updated = {
      ...get().stationFoodOrders,
      [stationName]: [...currentOrders, ...newItems],
    };
    set({ stationFoodOrders: updated });
  },

  getStationFoodOrders: (stationName) => {
    const orders = get().stationFoodOrders[stationName];
    return Array.isArray(orders) ? orders : [];
  },

  clearStationFoodOrders: (stationName) => {
    const updated = { ...get().stationFoodOrders };
    delete updated[stationName];
    set({ stationFoodOrders: updated });
  },

  // Station Games
  stationGames: DEFAULT_STATION_GAMES,

  updateStationGames: (stationId, games) => {
    const updated = { ...get().stationGames, [stationId]: games };
    set({ stationGames: updated });
  },

  // Advance Bookings & Dynamic Conflict Engine Store
  bookings: (() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const saved = localStorage.getItem('vanya_lounge_advance_bookings_v3');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            // Filter out old demo dummy seed entries (BK-1001, BK-1002)
            const realBookings = parsed.filter(
              (b) => b.bookingId !== 'BK-1001' && b.bookingId !== 'BK-1002' && b.id !== 'BK-1001' && b.id !== 'BK-1002'
            );
            return sortBookingsUpcomingWise(realBookings);
          }
        }
      } catch {
        // fallback
      }
    }
    return [] as AdvanceBooking[];
  })(),

  addBooking: (bookingData) => {
    const rawId = bookingData.bookingId || bookingData.id || `BK-${Date.now().toString().slice(-4)}`;
    const nowStr = new Date().toTimeString().slice(0, 5);
    const dateStr = bookingData.bookingDate || new Date().toISOString().split('T')[0];
    const sTime = bookingData.startTime || nowStr;
    const dur = bookingData.durationMinutes || 60;
    
    // Calculate end time if not given
    let eTime = bookingData.endTime;
    if (!eTime) {
      const [h, m] = sTime.split(':').map((x) => parseInt(x, 10) || 0);
      const totalM = h * 60 + m + dur;
      const endH = Math.floor(totalM / 60) % 24;
      const endM = totalM % 60;
      eTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
    }

    const totalAmt = Number(bookingData.totalAmount ?? bookingData.totalCost ?? 180);
    const advPaid = Number(bookingData.advancePaid ?? 0);
    const remBal = bookingData.remainingBalance !== undefined ? bookingData.remainingBalance : Math.max(0, totalAmt - advPaid);

    const newBooking: AdvanceBooking = {
      ...bookingData,
      bookingId: rawId,
      id: rawId,
      sessionMode: bookingData.sessionMode || 'Solo',
      bookingDate: dateStr,
      startTime: sTime,
      durationMinutes: dur,
      endTime: eTime,
      advancePaid: advPaid,
      totalAmount: totalAmt,
      remainingBalance: remBal,
      stationName: bookingData.stationName || bookingData.stationId,
      status: (bookingData.status as any) || 'CONFIRMED',
      createdAt: new Date().toISOString(),
    };
    const currentBookings = Array.isArray(get().bookings) ? get().bookings : [];
    const updated = sortBookingsUpcomingWise([newBooking, ...currentBookings]);
    set({ bookings: updated });
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        localStorage.setItem('vanya_lounge_advance_bookings_v3', JSON.stringify(updated));
      } catch {
        // storage quota fallback
      }
    }
    broadcastLoungeSync('BOOKINGS_SYNC', updated);
    return newBooking;
  },

  updateBooking: (bookingId, updates) => {
    const norm = String(bookingId || '').trim();
    const currentBookings = Array.isArray(get().bookings) ? get().bookings : [];
    const updated = sortBookingsUpcomingWise(
      currentBookings.map((b) => {
        const match = String(b.bookingId || '').trim() === norm || String(b.id || '').trim() === norm || String(b.bookingId || '').replace(/^BK-/, '').trim() === norm.replace(/^BK-/, '').trim() || String(b.id || '').replace(/^BK-/, '').trim() === norm.replace(/^BK-/, '').trim();
        if (!match) return b;
        const merged = { ...b, ...updates };
        if (updates.totalAmount !== undefined || updates.advancePaid !== undefined) {
          merged.remainingBalance = Math.max(0, merged.totalAmount - merged.advancePaid);
        }
        return merged;
      })
    );
    set({ bookings: updated });
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        localStorage.setItem('vanya_lounge_advance_bookings_v3', JSON.stringify(updated));
      } catch {}
    }
    broadcastLoungeSync('BOOKINGS_SYNC', updated);
  },

  cancelBooking: (bookingId) => {
    const norm = String(bookingId || '').trim();
    const currentBookings = Array.isArray(get().bookings) ? get().bookings : [];
    const updated = sortBookingsUpcomingWise(
      currentBookings.map((b) => {
        const match = String(b.bookingId || '').trim() === norm || String(b.id || '').trim() === norm || String(b.bookingId || '').replace(/^BK-/, '').trim() === norm.replace(/^BK-/, '').trim() || String(b.id || '').replace(/^BK-/, '').trim() === norm.replace(/^BK-/, '').trim();
        return match ? { ...b, status: 'CANCELLED' as const } : b;
      })
    );
    set({ bookings: updated });
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        localStorage.setItem('vanya_lounge_advance_bookings_v3', JSON.stringify(updated));
      } catch {}
    }
    broadcastLoungeSync('BOOKINGS_SYNC', updated);
  },

  activateBooking: (bookingId) => {
    const norm = String(bookingId || '').trim();
    const currentBookings = Array.isArray(get().bookings) ? get().bookings : [];
    const updated = sortBookingsUpcomingWise(
      currentBookings.map((b) => {
        const match = String(b.bookingId || '').trim() === norm || String(b.id || '').trim() === norm || String(b.bookingId || '').replace(/^BK-/, '').trim() === norm.replace(/^BK-/, '').trim() || String(b.id || '').replace(/^BK-/, '').trim() === norm.replace(/^BK-/, '').trim();
        return match ? { ...b, status: 'ACTIVE' as const } : b;
      })
    );
    set({ bookings: updated });
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        localStorage.setItem('vanya_lounge_advance_bookings_v3', JSON.stringify(updated));
      } catch {}
    }
    broadcastLoungeSync('BOOKINGS_SYNC', updated);
  },

  completeBooking: (bookingId) => {
    const norm = String(bookingId || '').trim();
    const currentBookings = Array.isArray(get().bookings) ? get().bookings : [];
    const updated = sortBookingsUpcomingWise(
      currentBookings.map((b) => {
        const match = String(b.bookingId || '').trim() === norm || String(b.id || '').trim() === norm || String(b.bookingId || '').replace(/^BK-/, '').trim() === norm.replace(/^BK-/, '').trim() || String(b.id || '').replace(/^BK-/, '').trim() === norm.replace(/^BK-/, '').trim();
        return match ? { ...b, status: 'COMPLETED' as const } : b;
      })
    );
    set({ bookings: updated });
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        localStorage.setItem('vanya_lounge_advance_bookings_v3', JSON.stringify(updated));
      } catch {}
    }
    broadcastLoungeSync('BOOKINGS_SYNC', updated);
  },

  completeActiveBookingForStation: (stationId) => {
    const norm = (stationId || '').trim().toUpperCase();
    const currentBookings = Array.isArray(get().bookings) ? get().bookings : [];
    const updated = sortBookingsUpcomingWise(
      currentBookings.map((b) => {
        const bSt = (b.stationId || '').trim().toUpperCase();
        if (bSt === norm && (b.status === 'ACTIVE' || b.status === 'CONFIRMED')) {
          return { ...b, status: 'COMPLETED' as const };
        }
        return b;
      })
    );
    set({ bookings: updated });
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        localStorage.setItem('vanya_lounge_advance_bookings_v3', JSON.stringify(updated));
      } catch {}
    }
    broadcastLoungeSync('BOOKINGS_SYNC', updated);
  },

  // Transactions & Revenue Summary (In-memory fallback; real analytics read from SQLite /api/v1/admin/analytics/revenue)
  financialRecords: [],

  recordTransaction: (recordData) => {
    const now = new Date();
    const newRecord: FinancialRecord = {
      ...recordData,
      id: `INV-${Date.now().toString().slice(-6)}`,
      timestamp: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      dateStr: now.toISOString().split('T')[0],
    };

    const currentRecords = Array.isArray(get().financialRecords) ? get().financialRecords : [];
    const updated = [newRecord, ...currentRecords];
    set({ financialRecords: updated });
    return newRecord;
  },


  recordCustomerVisit: (_name, _phone, _spentAmount = 0) => {
    // Visits are recorded directly into the backend SQL database via check_in
  },
}));

// Cross-tab real-time listener: syncs state across all open browser tabs and windows
if (syncChannel) {
  syncChannel.onmessage = (event) => {
    try {
      const { type, payload } = event.data || {};
      if (type === 'BOOKINGS_SYNC' && Array.isArray(payload)) {
        useLoungeStore.setState({ bookings: payload });
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('vanya_sync_invalidate', { detail: { type, payload } }));
        }
      } else if (type === 'ORDERS_SYNC' && Array.isArray(payload)) {
        useLoungeStore.setState({ inSeatOrders: payload });
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('vanya_sync_invalidate', { detail: { type, payload } }));
        }
      }
    } catch {}
  };
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === 'vanya_lounge_advance_bookings_v3' && e.newValue) {
      try {
        const parsed = JSON.parse(e.newValue);
        if (Array.isArray(parsed)) {
          useLoungeStore.setState({ bookings: parsed });
          window.dispatchEvent(new CustomEvent('vanya_sync_invalidate', { detail: { type: 'BOOKINGS_SYNC', payload: parsed } }));
        }
      } catch {}
    }
  });
}

