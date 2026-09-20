import { create } from 'zustand';

export type UserRole = 'admin' | 'customer';

export interface AuthUser {
  id: string;
  name: string;
  username: string;
  role: UserRole;
  phone?: string;
  deskId?: string;
}

interface AuthState {
  user: AuthUser | null;
  loginAsCustomer: (username: string, name?: string, phone?: string) => void;
  loginAsAdmin: (username: string) => void;
  registerCustomer: (name: string, username: string, phone: string) => void;
  logout: () => void;
}

const STORAGE_KEY = 'apex_cyber_lounge_auth';

// Load initial state from localStorage if available
function loadSavedUser(): AuthUser | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  user: loadSavedUser(),

  loginAsCustomer: (username: string, name?: string, phone?: string) => {
    const user: AuthUser = {
      id: `cust_${Date.now()}`,
      name: name || username,
      username,
      role: 'customer',
      phone,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    } catch (e) {
      console.error(e);
    }
    set({ user });
  },

  loginAsAdmin: (username: string) => {
    const user: AuthUser = {
      id: `admin_${Date.now()}`,
      name: 'System Administrator',
      username,
      role: 'admin',
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    } catch (e) {
      console.error(e);
    }
    set({ user });
  },

  registerCustomer: (name: string, username: string, phone: string) => {
    const user: AuthUser = {
      id: `cust_${Date.now()}`,
      name,
      username,
      role: 'customer',
      phone,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    } catch (e) {
      console.error(e);
    }
    set({ user });
  },

  logout: () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.error(e);
    }
    set({ user: null });
  },
}));
