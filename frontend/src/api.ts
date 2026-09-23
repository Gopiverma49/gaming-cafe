import {
  StationLive,
  PricingTier,
  MenuItem,
  Order,
  OrderStatus,
  CheckoutResult,
  CustomerDeskSession,
  AuthUser,
  AuthTokenResponse,
  CustomerRecord,
  CustomerSessionRecord,
  RevenueAnalyticsSummary,
  CategoryAvailability,
  SessionStartPayload,
} from './types';

import { useAuthStore } from './store/authStore';

const RAW_BASE = import.meta.env.VITE_API_BASE_URL
  ? String(import.meta.env.VITE_API_BASE_URL).replace(/\/+$/, '')
  : '';

export const API_BASE = `${RAW_BASE}/api/v1`;

const DEFAULT_TIMEOUT_MS = 12000;

async function getAuthHeaders(url?: string): Promise<Record<string, string>> {
  const state = useAuthStore.getState();

  // If in customer portal, strictly use the customer token (or null if not logged in).
  // Never leak or inject admin token in customer portal, preserving strict session isolation.
  if (state.currentPortal === 'customer') {
    const token = state.customerToken || (state.user?.role === 'customer' ? state.token : null);
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  const isAdminRoute = url ? url.includes('/admin/') : state.currentPortal === 'admin';
  const token = (isAdminRoute && state.adminToken) ? state.adminToken : (state.token || state.adminToken || state.customerToken);

  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Resilient fetch wrapper with network timeout, connection abort safety,
 * automatic Bearer token injection, and comprehensive error diagnostics.
 */
async function safeFetch(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const mergedSignal = options.signal
    ? options.signal
    : controller.signal;

  const headers = new Headers(options.headers || {});
  const authHeaders = await getAuthHeaders(url);
  for (const [key, value] of Object.entries(authHeaders)) {
    if (!headers.has(key)) {
      headers.set(key, value);
    }
  }

  try {
    const res = await fetch(url, {
      ...options,
      headers,
      signal: mergedSignal,
    });

    // If calling an admin endpoint with expired/invalid credentials, cleanly log out
    if (res.status === 401 && url.includes('/admin/')) {
      useAuthStore.getState().logout();
    }

    return res;
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs / 1000}s. Please check backend server status.`);
    }
    if (err instanceof TypeError && err.message.toLowerCase().includes('failed to fetch')) {
      throw new Error('Unable to connect to backend server. Please verify the API is running on localhost:8000.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function handleResponse<T>(res: Response, fallbackValue?: T): Promise<T> {
  // Handle 204 No Content
  if (res.status === 204) {
    return (fallbackValue !== undefined ? fallbackValue : ({} as T));
  }

  if (!res.ok) {
    let errorDetail = `Request failed with status ${res.status} (${res.statusText || 'Error'})`;
    try {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const errJson = await res.json();
        errorDetail = errJson.detail || errJson.message || JSON.stringify(errJson);
      } else {
        const text = await res.text();
        if (text && text.length < 200) {
          errorDetail = text;
        }
      }
    } catch {
      // Keep default errorDetail if response body cannot be parsed
    }
    throw new Error(errorDetail);
  }

  try {
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await res.json();
      return (data !== null && data !== undefined) ? data : (fallbackValue as T);
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : fallbackValue) as T;
  } catch {
    return (fallbackValue !== undefined ? fallbackValue : ({} as T));
  }
}

// ---------------------------------------------------------------------------
// 1. Authentication API (Database-Backed)
// ---------------------------------------------------------------------------
export async function registerCustomerApi(data: {
  name: string;
  phone: string;
  password: string;
}): Promise<AuthTokenResponse> {
  const res = await safeFetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return handleResponse<AuthTokenResponse>(res);
}

export async function loginUserApi(data: {
  identifier: string;
  password: string;
}): Promise<AuthTokenResponse> {
  const res = await safeFetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return handleResponse<AuthTokenResponse>(res);
}

export async function fetchCurrentUserApi(token: string): Promise<AuthUser> {
  const res = await safeFetch(`${API_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<AuthUser>(res);
}

// Admin API
export async function loginAdminApi(username: string, password: string): Promise<{ access_token: string }> {
  const res = await safeFetch(`${API_BASE}/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return handleResponse<{ access_token: string }>(res);
}

export async function fetchLiveStations(): Promise<StationLive[]> {
  const res = await safeFetch(`${API_BASE}/admin/stations/live`);
  const data = await handleResponse<StationLive[]>(res, []);
  return Array.isArray(data) ? data : [];
}

export async function fetchFleetCategories(): Promise<CategoryAvailability[]> {
  const res = await safeFetch(`${API_BASE}/admin/fleet/categories`);
  const data = await handleResponse<CategoryAvailability[]>(res, []);
  return Array.isArray(data) ? data : [];
}

export async function startCategorySessionApi(payload: SessionStartPayload) {
  const res = await safeFetch(`${API_BASE}/sessions/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handleResponse<any>(res);
}

export async function checkInStation(
  stationId: string,
  allocatedMinutes: number = 60,
  customerName?: string,
  customerPhone?: string,
  userId?: string,
  tierPrice?: number,
  deviceId?: string
) {
  const res = await safeFetch(`${API_BASE}/admin/sessions/check-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      station_id: stationId,
      allocated_minutes: allocatedMinutes,
      customer_name: customerName,
      customer_phone: customerPhone,
      user_id: userId,
      tier_price: tierPrice,
      device_id: deviceId,
    }),
  });
  return handleResponse<{ message: string; session_id: string; station_id: string; device_name?: string }>(res);
}

export async function transferStation(sessionId: string, targetStationId: string) {
  const res = await safeFetch(`${API_BASE}/admin/sessions/transfer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      target_station_id: targetStationId,
    }),
  });
  return handleResponse<{ message: string; session_id: string; new_station_id: string }>(res);
}

export async function createStation(data: {
  name: string;
  tier: string;
  hourly_rate?: number;
  default_hourly_rate?: number;
  pricing_tiers?: PricingTier[];
}) {
  const res = await safeFetch(`${API_BASE}/admin/stations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return handleResponse<{ id: string; name: string; tier: string; hourly_rate: number; status: string; pricing_tiers?: PricingTier[] }>(res);
}

export async function updateStation(
  stationId: string,
  data: {
    name?: string;
    tier?: string;
    hourly_rate?: number;
    default_hourly_rate?: number;
    pricing_tiers?: PricingTier[];
    status?: string;
  }
) {
  const res = await safeFetch(`${API_BASE}/admin/stations/${stationId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return handleResponse<{ id: string; name: string; tier: string; hourly_rate: number; status: string; pricing_tiers?: PricingTier[] }>(res);
}

export async function deleteStation(stationId: string) {
  const res = await safeFetch(`${API_BASE}/admin/stations/${stationId}`, {
    method: 'DELETE',
  });
  if (res.status === 204) return;
  return handleResponse<void>(res);
}

export async function checkoutSession(sessionId: string, paymentMethod: 'CASH' | 'UPI'): Promise<CheckoutResult> {
  const idempotencyKey = `chk-${sessionId}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const res = await safeFetch(`${API_BASE}/admin/sessions/checkout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      session_id: sessionId,
      payment_method: paymentMethod,
    }),
  });
  return handleResponse<CheckoutResult>(res);
}

export async function fetchKitchenOrders(): Promise<Order[]> {
  const res = await safeFetch(`${API_BASE}/admin/kitchen/orders`);
  const data = await handleResponse<Order[]>(res, []);
  return Array.isArray(data) ? data : [];
}

export async function updateKitchenOrderStatus(orderId: string, status: OrderStatus): Promise<Order> {
  const res = await safeFetch(`${API_BASE}/admin/kitchen/orders/${orderId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  return handleResponse<Order>(res);
}

// Customer API
export async function fetchMenuItems(): Promise<MenuItem[]> {
  const res = await safeFetch(`${API_BASE}/customer/menu`);
  const data = await handleResponse<MenuItem[]>(res, []);
  return Array.isArray(data) ? data : [];
}

export async function getCustomerToken(deskId: string, sessionId: string): Promise<{ access_token: string }> {
  const res = await safeFetch(`${API_BASE}/customer/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      desk_id: deskId,
      session_id: sessionId,
    }),
  });
  return handleResponse<{ access_token: string }>(res);
}

export async function fetchDeskSession(token: string): Promise<CustomerDeskSession> {
  const res = await safeFetch(`${API_BASE}/customer/desk/session`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  return handleResponse<CustomerDeskSession>(res);
}

export async function placeCustomerOrder(
  token: string,
  items: { menu_item_id: string; quantity: number }[]
): Promise<Order> {
  const idempotencyKey = `ord-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const res = await safeFetch(`${API_BASE}/customer/order`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({ items }),
  });
  return handleResponse<Order>(res);
}

// ---------------------------------------------------------------------------
// Menu & Inventory Management (Database-Backed)
// ---------------------------------------------------------------------------
export async function fetchAdminMenuItems(): Promise<MenuItem[]> {
  const res = await safeFetch(`${API_BASE}/admin/menu`);
  const data = await handleResponse<MenuItem[]>(res, []);
  return Array.isArray(data) ? data : [];
}

export async function createMenuItemApi(data: {
  name: string;
  category: string;
  price: number;
  stock?: number;
  min_stock_alert?: number;
  is_available?: boolean;
}): Promise<MenuItem> {
  const res = await safeFetch(`${API_BASE}/admin/menu`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return handleResponse<MenuItem>(res);
}

export async function updateMenuItemApi(
  itemId: string,
  data: {
    name?: string;
    category?: string;
    price?: number;
    stock?: number;
    min_stock_alert?: number;
    is_available?: boolean;
  }
): Promise<MenuItem> {
  const res = await safeFetch(`${API_BASE}/admin/menu/${itemId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return handleResponse<MenuItem>(res);
}

export async function deleteMenuItemApi(itemId: string): Promise<void> {
  const res = await safeFetch(`${API_BASE}/admin/menu/${itemId}`, {
    method: 'DELETE',
  });
  if (res.status === 204) return;
  return handleResponse<void>(res);
}

export async function restockMenuItemApi(itemId: string, amount: number): Promise<MenuItem> {
  const res = await safeFetch(`${API_BASE}/admin/inventory/restock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item_id: itemId, amount }),
  });
  return handleResponse<MenuItem>(res);
}

// ---------------------------------------------------------------------------
// Station Food Ordering (Database-Backed with Stock Deduction)
// ---------------------------------------------------------------------------
export async function placeStationOrderApi(data: {
  station_id: string;
  items: { menu_item_id: string; quantity: number }[];
  customer_name?: string;
}): Promise<Order> {
  const res = await safeFetch(`${API_BASE}/admin/orders/station-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return handleResponse<Order>(res);
}

// ---------------------------------------------------------------------------
// Customer Directory & Footfall Logs (Database-Backed)
// ---------------------------------------------------------------------------
export async function fetchAdminCustomers(): Promise<CustomerRecord[]> {
  const res = await safeFetch(`${API_BASE}/admin/customers`);
  const data = await handleResponse<CustomerRecord[]>(res, []);
  return Array.isArray(data) ? data : [];
}

// ---------------------------------------------------------------------------
// Real Database Customer Sessions & Reservations
// ---------------------------------------------------------------------------
export async function fetchCustomerSessions(filter?: {
  phone?: string;
  name?: string;
  userId?: string;
}): Promise<CustomerSessionRecord[]> {
  const params = new URLSearchParams();
  if (filter?.phone) params.append('phone', filter.phone);
  if (filter?.name) params.append('name', filter.name);
  if (filter?.userId) params.append('user_id', filter.userId);

  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await safeFetch(`${API_BASE}/customer/sessions${query}`);
  const data = await handleResponse<CustomerSessionRecord[]>(res, []);
  return Array.isArray(data) ? data : [];
}

export async function cancelCustomerSessionApi(
  sessionId: string
): Promise<{ message: string; session_id: string }> {
  const res = await safeFetch(`${API_BASE}/customer/sessions/${sessionId}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  return handleResponse<{ message: string; session_id: string }>(res);
}

// ---------------------------------------------------------------------------
// Real Database Financial & Revenue Analytics
// ---------------------------------------------------------------------------
export async function fetchRevenueAnalyticsApi(
  period: 'DAY' | 'WEEK' | 'MONTH' = 'DAY'
): Promise<RevenueAnalyticsSummary> {
  const res = await safeFetch(`${API_BASE}/admin/analytics/revenue?period=${period}`);
  return handleResponse<RevenueAnalyticsSummary>(res, {
    totalRevenue: 0,
    gamingRevenue: 0,
    foodRevenue: 0,
    sessionsCount: 0,
    averageSessionBill: 0,
    topSellingItem: 'None',
    chartData: [],
  });
}

