import { create } from 'zustand';
import { MenuItem } from '../types';

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
  // Menu & Stock Inventory
  customMenuItems: MenuItem[];
  addMenuItem: (item: Omit<MenuItem, 'id'>) => void;
  updateMenuItemPrice: (id: string, newPrice: number) => void;
  updateMenuItem: (id: string, updates: Partial<MenuItem>) => void;
  toggleMenuItemAvailability: (id: string) => void;
  deleteMenuItem: (id: string) => void;

  // Inventory Stock Controls
  restockItem: (id: string, amount: number) => void;
  setExactStock: (id: string, exactStock: number) => void;
  deductStock: (items: { id: string; quantity: number }[]) => boolean;

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

  // Completed Financial Records (Day, Week, Month)
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
}

const DEFAULT_MENU_ITEMS: MenuItem[] = [
  { id: 'menu_1', name: 'Monster Energy (Original)', category: 'Beverages', price: 140, is_available: true, stock: 24 },
  { id: 'menu_2', name: 'Red Bull Classic 250ml', category: 'Beverages', price: 160, is_available: true, stock: 18 },
  { id: 'menu_3', name: 'Cold Brew Iced Coffee', category: 'Beverages', price: 110, is_available: true, stock: 15 },
  { id: 'menu_4', name: 'Mountain Dew Game Fuel', category: 'Beverages', price: 80, is_available: true, stock: 30 },
  { id: 'menu_5', name: 'Crispy Peri-Peri Fries', category: 'Food', price: 150, is_available: true, stock: 25 },
  { id: 'menu_6', name: 'Double Smash Cheeseburger', category: 'Food', price: 280, is_available: true, stock: 12 },
  { id: 'menu_7', name: 'Classic Pepperoni Pizza Pocket', category: 'Food', price: 220, is_available: true, stock: 16 },
  { id: 'menu_8', name: 'Korean Spicy Chicken Wings (6pcs)', category: 'Food', price: 290, is_available: true, stock: 10 },
  { id: 'menu_9', name: 'Nacho Chips & Warm Cheese Dip', category: 'Food', price: 170, is_available: true, stock: 20 },
];

const DEFAULT_STATION_GAMES: Record<string, string[]> = {
  PS1: ['EA Sports FC 24 (FIFA)', 'Marvel Spider-Man 2', 'Tekken 8', 'Mortal Kombat 1', 'Gran Turismo 7'],
  PS2: ['EA Sports FC 24 (FIFA)', 'Marvel Spider-Man 2', 'Tekken 8', 'God of War Ragnarök', 'NBA 2K24'],
  PS3: ['EA Sports FC 24 (FIFA)', 'Marvel Spider-Man 2', 'Tekken 8', 'Street Fighter 6', 'Hogwarts Legacy'],
  default_ps5: ['EA Sports FC 24 (FIFA)', 'Marvel Spider-Man 2', 'Tekken 8', 'Mortal Kombat 1', 'Gran Turismo 7'],
};

// Seed sample historical records so day, week, month charts look vivid immediately
function getSeedFinancialRecords(): FinancialRecord[] {
  const records: FinancialRecord[] = [];
  const now = new Date();

  // Generate realistic transactions across past 30 days
  const stations = ['PS1', 'PS2', 'PS3'];
  for (let i = 0; i < 25; i++) {
    const pastDate = new Date(now.getTime() - i * 28 * 3600 * 1000);
    const dateStr = pastDate.toISOString().split('T')[0];
    const timeCharge = [180, 250, 360, 500, 700][i % 5];
    const foodCharge = [0, 140, 280, 420, 560][i % 5];
    records.push({
      id: `TX-${1000 + i}`,
      stationName: stations[i % stations.length],
      timeCharge,
      foodCharge,
      totalAmount: timeCharge + foodCharge,
      paymentMethod: i % 2 === 0 ? 'UPI' : 'CASH',
      timestamp: pastDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      dateStr,
    });
  }
  return records;
}

const STORAGE_KEY_MENU = 'vanya_lounge_custom_menu_v2';
const STORAGE_KEY_GAMES = 'vanya_lounge_station_games_v2';
const STORAGE_KEY_BOOKINGS = 'vanya_lounge_bookings_v2';
const STORAGE_KEY_ORDERS = 'vanya_lounge_station_orders_v2';
const STORAGE_KEY_FINANCE = 'vanya_lounge_financial_records_v2';

function loadStored<T>(key: string, fallback: T): T {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : fallback;
  } catch {
    return fallback;
  }
}

export const useLoungeStore = create<LoungeState>((set, get) => ({
  customMenuItems: loadStored<MenuItem[]>(STORAGE_KEY_MENU, DEFAULT_MENU_ITEMS),
  stationGames: loadStored<Record<string, string[]>>(STORAGE_KEY_GAMES, DEFAULT_STATION_GAMES),
  bookings: loadStored<AdvanceBooking[]>(STORAGE_KEY_BOOKINGS, []),
  stationFoodOrders: loadStored<Record<string, OrderedFoodItem[]>>(STORAGE_KEY_ORDERS, {}),
  financialRecords: loadStored<FinancialRecord[]>(STORAGE_KEY_FINANCE, getSeedFinancialRecords()),

  addMenuItem: (item) => {
    const newItem: MenuItem = {
      ...item,
      id: `menu_item_${Date.now()}`,
      stock: item.stock ?? 20,
    };
    const updated = [...get().customMenuItems, newItem];
    localStorage.setItem(STORAGE_KEY_MENU, JSON.stringify(updated));
    set({ customMenuItems: updated });
  },

  updateMenuItemPrice: (id, newPrice) => {
    const updated = get().customMenuItems.map((item) =>
      item.id === id ? { ...item, price: newPrice } : item
    );
    localStorage.setItem(STORAGE_KEY_MENU, JSON.stringify(updated));
    set({ customMenuItems: updated });
  },

  updateMenuItem: (id, updates) => {
    const updated = get().customMenuItems.map((item) =>
      item.id === id ? { ...item, ...updates } : item
    );
    localStorage.setItem(STORAGE_KEY_MENU, JSON.stringify(updated));
    set({ customMenuItems: updated });
  },

  toggleMenuItemAvailability: (id) => {
    const updated = get().customMenuItems.map((item) =>
      item.id === id ? { ...item, is_available: !item.is_available } : item
    );
    localStorage.setItem(STORAGE_KEY_MENU, JSON.stringify(updated));
    set({ customMenuItems: updated });
  },

  deleteMenuItem: (id) => {
    const updated = get().customMenuItems.filter((item) => item.id !== id);
    localStorage.setItem(STORAGE_KEY_MENU, JSON.stringify(updated));
    set({ customMenuItems: updated });
  },

  // Stock operations
  restockItem: (id, amount) => {
    const updated = get().customMenuItems.map((item) => {
      if (item.id === id) {
        const newStock = Math.max(0, (item.stock || 0) + amount);
        return {
          ...item,
          stock: newStock,
          is_available: newStock > 0,
        };
      }
      return item;
    });
    localStorage.setItem(STORAGE_KEY_MENU, JSON.stringify(updated));
    set({ customMenuItems: updated });
  },

  setExactStock: (id, exactStock) => {
    const updated = get().customMenuItems.map((item) => {
      if (item.id === id) {
        return {
          ...item,
          stock: Math.max(0, exactStock),
          is_available: exactStock > 0,
        };
      }
      return item;
    });
    localStorage.setItem(STORAGE_KEY_MENU, JSON.stringify(updated));
    set({ customMenuItems: updated });
  },

  deductStock: (items) => {
    const qtyMap = new Map(items.map((i) => [i.id, i.quantity]));
    const allUpdated = get().customMenuItems.map((item) => {
      const deduction = qtyMap.get(item.id);
      if (deduction !== undefined) {
        const remaining = Math.max(0, (item.stock || 0) - deduction);
        return {
          ...item,
          stock: remaining,
          is_available: remaining > 0,
        };
      }
      return item;
    });
    localStorage.setItem(STORAGE_KEY_MENU, JSON.stringify(allUpdated));
    set({ customMenuItems: allUpdated });
    return true;
  },

  // Active Station Food Orders
  addStationFoodOrder: (stationName, items) => {
    const currentOrders = get().stationFoodOrders[stationName] || [];
    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const newItems: OrderedFoodItem[] = items.map((i) => ({
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
    localStorage.setItem(STORAGE_KEY_ORDERS, JSON.stringify(updated));
    set({ stationFoodOrders: updated });
  },

  getStationFoodOrders: (stationName) => {
    return get().stationFoodOrders[stationName] || [];
  },

  clearStationFoodOrders: (stationName) => {
    const updated = { ...get().stationFoodOrders };
    delete updated[stationName];
    localStorage.setItem(STORAGE_KEY_ORDERS, JSON.stringify(updated));
    set({ stationFoodOrders: updated });
  },

  // Station Games
  updateStationGames: (stationId, games) => {
    const updated = { ...get().stationGames, [stationId]: games };
    localStorage.setItem(STORAGE_KEY_GAMES, JSON.stringify(updated));
    set({ stationGames: updated });
  },

  // Bookings
  addBooking: (bookingData) => {
    const newBooking: AdvanceBooking = {
      ...bookingData,
      id: `BK-${Date.now().toString().slice(-6)}`,
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    const updated = [newBooking, ...get().bookings];
    localStorage.setItem(STORAGE_KEY_BOOKINGS, JSON.stringify(updated));
    set({ bookings: updated });
    return newBooking;
  },

  cancelBooking: (id) => {
    const updated = get().bookings.filter((b) => b.id !== id);
    localStorage.setItem(STORAGE_KEY_BOOKINGS, JSON.stringify(updated));
    set({ bookings: updated });
  },

  // Transactions & Revenue Summary
  recordTransaction: (recordData) => {
    const now = new Date();
    const newRecord: FinancialRecord = {
      ...recordData,
      id: `INV-${Date.now().toString().slice(-6)}`,
      timestamp: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      dateStr: now.toISOString().split('T')[0],
    };

    const updated = [newRecord, ...get().financialRecords];
    localStorage.setItem(STORAGE_KEY_FINANCE, JSON.stringify(updated));
    set({ financialRecords: updated });
    return newRecord;
  },

  getRevenueSummary: (period) => {
    const records = get().financialRecords;
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    // Calculate cutoff
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
      const recordDate = new Date(r.dateStr);
      return recordDate >= cutoff;
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

    // Daily breakdown for visual bars
    const chartMap: Record<string, { total: number; gaming: number; food: number }> = {};
    const daysToShow = period === 'DAY' ? 1 : period === 'WEEK' ? 7 : 14;

    for (let i = daysToShow - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000);
      const key = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
      const dStr = d.toISOString().split('T')[0];
      const dayRecs = recordsByDate.get(dStr) || [];
      chartMap[key] = {
        total: dayRecs.reduce((s, r) => s + r.totalAmount, 0),
        gaming: dayRecs.reduce((s, r) => s + r.timeCharge, 0),
        food: dayRecs.reduce((s, r) => s + r.foodCharge, 0),
      };
    }

    const chartData = Object.entries(chartMap).map(([label, val]) => ({
      label,
      total: val.total,
      gaming: val.gaming,
      food: val.food,
    }));

    // Dynamically identify the top selling item from recorded food transactions
    const itemCounts = new Map<string, number>();
    for (const r of filtered) {
      if (r.foodItems) {
        for (const item of r.foodItems) {
          itemCounts.set(item.name, (itemCounts.get(item.name) || 0) + item.quantity);
        }
      }
    }
    let topSellingItem = 'Loaded Smash Burger';
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
}));
