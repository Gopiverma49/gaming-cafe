import { create } from 'zustand';

export interface AdvanceBooking {
  id: string;
  stationId: string;
  stationName: string;
  customerName: string;
  customerPhone?: string;
  bookingType: 'NOW' | 'ADVANCE';
  scheduledTime: string;
  durationMinutes: number;
  hourlyRate: number;
  totalCost: number;
  status: 'CONFIRMED' | 'CHECKED_IN' | 'CANCELLED';
  createdAt: string;
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

interface LoungeState {
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
  addBooking: (booking: Omit<AdvanceBooking, 'id' | 'createdAt'>) => AdvanceBooking;
  cancelBooking: (id: string) => void;

  // Completed Financial Records & Revenue Analytics
  financialRecords: FinancialRecord[];
  recordTransaction: (record: Omit<FinancialRecord, 'id' | 'timestamp' | 'dateStr'>) => FinancialRecord;
  getRevenueSummary: (period: 'DAY' | 'WEEK' | 'MONTH') => {
    totalRevenue: number;
    gamingRevenue: number;
    foodRevenue: number;
    sessionsCount: number;
    averageSessionBill: number;
    topSellingItem: string;
    chartData: { label: string; total: number; gaming: number; food: number }[];
  };

  // Local Customer Visit Tracker
  recordCustomerVisit: (name: string, phone?: string, spentAmount?: number) => void;
}

const DEFAULT_STATION_GAMES: Record<string, string[]> = {
  PS3: ['EA Sports FC 24 (FIFA)', 'Marvel Spider-Man 2', 'Tekken 8', 'Street Fighter 6', 'Hogwarts Legacy'],
  Solo: ['God of War Ragnarök', 'Ghost of Tsushima', 'Elden Ring', 'Cyberpunk 2077', 'Spider-Man 2'],
  multiplyer: ['EA Sports FC 24 (FIFA)', 'Tekken 8', 'Mortal Kombat 1', 'NBA 2K24', 'Call of Duty: Warzone'],
};

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

  // Bookings (In-memory fallback; real reservations read from SQLite /api/v1/customer/sessions)
  bookings: [],

  addBooking: (bookingData) => {
    const newBooking: AdvanceBooking = {
      ...bookingData,
      id: `BK-${Date.now().toString().slice(-6)}`,
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    const currentBookings = Array.isArray(get().bookings) ? get().bookings : [];
    const updated = [newBooking, ...currentBookings];
    set({ bookings: updated });
    return newBooking;
  },

  cancelBooking: (id) => {
    const currentBookings = Array.isArray(get().bookings) ? get().bookings : [];
    const updated = currentBookings.filter((b) => b?.id !== id);
    set({ bookings: updated });
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

  getRevenueSummary: (period) => {
    const rawRecords = get().financialRecords;
    const records = Array.isArray(rawRecords) ? rawRecords : [];
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    const cutoff = new Date();
    if (period === 'DAY') {
      cutoff.setHours(0, 0, 0, 0);
    } else if (period === 'WEEK') {
      cutoff.setDate(now.getDate() - 7);
    } else {
      cutoff.setDate(now.getDate() - 30);
    }

    const filtered = records.filter((r) => {
      if (period === 'DAY') {
        return r.dateStr === todayStr;
      }
      return new Date(r.dateStr) >= cutoff;
    });

    const totalRevenue = filtered.reduce((s, r) => s + r.totalAmount, 0);
    const gamingRevenue = filtered.reduce((s, r) => s + r.timeCharge, 0);
    const foodRevenue = filtered.reduce((s, r) => s + r.foodCharge, 0);
    const sessionsCount = filtered.length;
    const averageSessionBill = sessionsCount > 0 ? totalRevenue / sessionsCount : 0;

    // Single-pass date index to avoid repetitive O(days * records) filtering
    const recordsByDate = new Map<string, FinancialRecord[]>();
    for (const r of records) {
      const list = recordsByDate.get(r.dateStr);
      if (list) {
        list.push(r);
      } else {
        recordsByDate.set(r.dateStr, [r]);
      }
    }

    const daysToShow = period === 'DAY' ? 1 : period === 'WEEK' ? 7 : 14;
    const chartData: { label: string; total: number; gaming: number; food: number }[] = [];

    for (let i = daysToShow - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000);
      const label = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
      const dStr = d.toISOString().split('T')[0];
      const dayRecs = recordsByDate.get(dStr) || [];
      chartData.push({
        label,
        total: dayRecs.reduce((s, r) => s + r.totalAmount, 0),
        gaming: dayRecs.reduce((s, r) => s + r.timeCharge, 0),
        food: dayRecs.reduce((s, r) => s + r.foodCharge, 0),
      });
    }

    let topSellingItem = 'Loaded Smash Burger';
    const itemCounts = new Map<string, number>();
    for (const r of filtered) {
      if (r.foodItems) {
        for (const item of r.foodItems) {
          itemCounts.set(item.name, (itemCounts.get(item.name) || 0) + item.quantity);
        }
      }
    }
    let maxCount = 0;
    for (const [name, count] of itemCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        topSellingItem = name;
      }
    }

    return {
      totalRevenue,
      gamingRevenue,
      foodRevenue,
      sessionsCount,
      averageSessionBill,
      topSellingItem,
      chartData,
    };
  },

  recordCustomerVisit: (_name, _phone, _spentAmount = 0) => {
    // Visits are recorded directly into the backend SQL database via check_in
  },
}));
