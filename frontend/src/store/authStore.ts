import { create } from 'zustand';
import { AuthUser } from '../types';

export type UserRole = 'admin' | 'customer';
export type PortalType = 'admin' | 'customer';

const ADMIN_STORAGE_KEY = 'vanya_admin_auth';
const ADMIN_TOKEN_KEY = 'vanya_admin_token';
const CUSTOMER_STORAGE_KEY = 'vanya_customer_auth';
const CUSTOMER_TOKEN_KEY = 'vanya_customer_token';

// Clean up any stale admin token accidentally saved in localStorage
if (typeof window !== 'undefined') {
  try {
    localStorage.removeItem(ADMIN_STORAGE_KEY);
    localStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {}
}

// Determine initial portal based on URL pathname
export function getCurrentPortal(): PortalType {
  if (typeof window === 'undefined') return 'customer';
  return window.location.pathname.toLowerCase().startsWith('/admin') ? 'admin' : 'customer';
}

// Load user from sessionStorage first (per-tab isolation), fallback to localStorage
function loadStoredUser(sessionKey: string, localKey: string): AuthUser | null {
  try {
    const raw = sessionStorage.getItem(sessionKey) || (localKey ? localStorage.getItem(localKey) : null);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.role === 'string') {
      parsed.role = parsed.role.toLowerCase();
    }
    return parsed;
  } catch {
    return null;
  }
}

// Load token from sessionStorage first, fallback to localStorage
function loadStoredToken(sessionKey: string, localKey: string): string | null {
  try {
    return sessionStorage.getItem(sessionKey) || (localKey ? localStorage.getItem(localKey) : null);
  } catch {
    return null;
  }
}

function saveToStorage(sessionKey: string, localKey: string, value: string | null) {
  try {
    if (value !== null) {
      sessionStorage.setItem(sessionKey, value);
      if (localKey) localStorage.setItem(localKey, value);
    } else {
      sessionStorage.removeItem(sessionKey);
      if (localKey) localStorage.removeItem(localKey);
    }
  } catch (e) {
    console.error(e);
  }
}

interface AuthState {
  currentPortal: PortalType;
  adminUser: AuthUser | null;
  adminToken: string | null;
  customerUser: AuthUser | null;
  customerToken: string | null;

  // Active user & token for the current portal
  user: AuthUser | null;
  token: string | null;

  setPortal: (portal: PortalType) => void;
  setAuth: (user: AuthUser, token: string, targetPortal?: PortalType) => void;
  ensureAdminToken: (force?: boolean) => Promise<string | null>;
  loginAsCustomer: (username: string, name?: string, phone?: string) => void;
  loginAsAdmin: (username?: string) => Promise<void>;
  registerCustomer: (name: string, username: string, phone: string) => void;
  logout: () => void;
}

const initialPortal = getCurrentPortal();
// Admin credentials are kept strictly in sessionStorage (tab-isolated, not auto-retained across restarts)
const initialAdminUser = loadStoredUser(ADMIN_STORAGE_KEY, '');
const initialAdminToken = loadStoredToken(ADMIN_TOKEN_KEY, '');
const initialCustomerUser = loadStoredUser(CUSTOMER_STORAGE_KEY, CUSTOMER_STORAGE_KEY);
const initialCustomerToken = loadStoredToken(CUSTOMER_TOKEN_KEY, CUSTOMER_TOKEN_KEY);

export const useAuthStore = create<AuthState>((set, get) => ({
  currentPortal: initialPortal,
  adminUser: initialAdminUser,
  adminToken: initialAdminToken,
  customerUser: initialCustomerUser,
  customerToken: initialCustomerToken,

  user: initialPortal === 'admin' ? initialAdminUser : initialCustomerUser,
  token: initialPortal === 'admin' ? initialAdminToken : initialCustomerToken,

  setPortal: (portal: PortalType) => {
    if (portal === 'admin') {
      if (!window.location.pathname.toLowerCase().startsWith('/admin')) {
        window.history.pushState(null, '', '/admin');
      }
      set((state) => ({
        currentPortal: 'admin',
        user: state.adminUser,
        token: state.adminToken,
      }));
    } else {
      if (window.location.pathname.toLowerCase().startsWith('/admin')) {
        window.history.pushState(null, '', '/');
      }
      set((state) => ({
        currentPortal: 'customer',
        user: state.customerUser,
        token: state.customerToken,
      }));
    }
  },

  ensureAdminToken: async (_force: boolean = false): Promise<string | null> => {
    return get().adminToken;
  },

  setAuth: (user: AuthUser, token: string, targetPortal?: PortalType) => {
    const role = (typeof user?.role === 'string' ? user.role.toLowerCase() : 'customer') as 'admin' | 'customer';
    const normalizedUser: AuthUser = {
      ...user,
      role,
    };
    const isTargetAdmin = targetPortal === 'admin' || role === 'admin';

    if (isTargetAdmin) {
      saveToStorage(ADMIN_STORAGE_KEY, '', JSON.stringify(normalizedUser));
      saveToStorage(ADMIN_TOKEN_KEY, '', token);
      set((state) => ({
        adminUser: normalizedUser,
        adminToken: token,
        ...(state.currentPortal === 'admin' ? { user: normalizedUser, token } : {}),
      }));
    } else {
      saveToStorage(CUSTOMER_STORAGE_KEY, CUSTOMER_STORAGE_KEY, JSON.stringify(normalizedUser));
      saveToStorage(CUSTOMER_TOKEN_KEY, CUSTOMER_TOKEN_KEY, token);
      set((state) => ({
        customerUser: normalizedUser,
        customerToken: token,
        ...(state.currentPortal === 'customer' ? { user: normalizedUser, token } : {}),
      }));
    }
  },

  loginAsCustomer: (username: string, name?: string, phone?: string) => {
    const user: AuthUser = {
      id: `cust_${Date.now()}`,
      name: name || username,
      phone: phone || '',
      role: 'customer',
    };
    saveToStorage(CUSTOMER_STORAGE_KEY, CUSTOMER_STORAGE_KEY, JSON.stringify(user));
    set((state) => ({
      customerUser: user,
      ...(state.currentPortal === 'customer' ? { user } : {}),
    }));
  },

  loginAsAdmin: async (username?: string) => {
    const fallbackUser: AuthUser = {
      id: `admin_${Date.now()}`,
      name: username || 'System Administrator',
      phone: '0000000000',
      role: 'admin',
    };
    saveToStorage(ADMIN_STORAGE_KEY, '', JSON.stringify(fallbackUser));
    set((state) => ({
      adminUser: fallbackUser,
      ...(state.currentPortal === 'admin' ? { user: fallbackUser } : {}),
    }));
  },

  registerCustomer: (name: string, _username: string, phone: string) => {
    const user: AuthUser = {
      id: `cust_${Date.now()}`,
      name,
      phone,
      role: 'customer',
    };
    saveToStorage(CUSTOMER_STORAGE_KEY, CUSTOMER_STORAGE_KEY, JSON.stringify(user));
    set((state) => ({
      customerUser: user,
      ...(state.currentPortal === 'customer' ? { user } : {}),
    }));
  },

  logout: () => {
    const portal = get().currentPortal;
    if (portal === 'admin') {
      saveToStorage(ADMIN_STORAGE_KEY, '', null);
      saveToStorage(ADMIN_TOKEN_KEY, '', null);
      set({ adminUser: null, adminToken: null, user: null, token: null });
    } else {
      saveToStorage(CUSTOMER_STORAGE_KEY, CUSTOMER_STORAGE_KEY, null);
      saveToStorage(CUSTOMER_TOKEN_KEY, CUSTOMER_TOKEN_KEY, null);
      set({ customerUser: null, customerToken: null, user: null, token: null });
    }
  },
}));

// Listen for browser Back/Forward navigation to sync current portal state
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    const portal = getCurrentPortal();
    useAuthStore.getState().setPortal(portal);
  });
}
