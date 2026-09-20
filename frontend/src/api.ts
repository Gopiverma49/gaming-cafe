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
} from './types';

const API_BASE = (import.meta.env.VITE_API_BASE_URL ? import.meta.env.VITE_API_BASE_URL.replace(/\/+$/, '') : '') + '/api/v1';

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let errorDetail = 'Network request failed';
    try {
      const errJson = await res.json();
      errorDetail = errJson.detail || errJson.message || JSON.stringify(errJson);
    } catch {
      errorDetail = await res.text();
    }
    throw new Error(errorDetail);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// 1. Authentication API (Database-Backed)
// ---------------------------------------------------------------------------
export async function registerCustomerApi(data: {
  name: string;
  phone: string;
  password: string;
}): Promise<AuthTokenResponse> {
  const res = await fetch(`${API_BASE}/auth/register`, {
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
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return handleResponse<AuthTokenResponse>(res);
}

export async function fetchCurrentUserApi(token: string): Promise<AuthUser> {
  const res = await fetch(`${API_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return handleResponse<AuthUser>(res);
}

// Admin API
export async function loginAdminApi(username: string, password: string): Promise<{ access_token: string }> {
  const res = await fetch(`${API_BASE}/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return handleResponse<{ access_token: string }>(res);
}

export async function fetchLiveStations(): Promise<StationLive[]> {
  const res = await fetch(`${API_BASE}/admin/stations/live`);
  return handleResponse<StationLive[]>(res);
}

export async function checkInStation(
  stationId: string,
  allocatedMinutes: number = 60,
  customerName?: string,
  customerPhone?: string,
  userId?: string
) {
  const res = await fetch(`${API_BASE}/admin/sessions/check-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      station_id: stationId,
      allocated_minutes: allocatedMinutes,
      customer_name: customerName,
      customer_phone: customerPhone,
      user_id: userId,
    }),
  });
  return handleResponse<{ message: string; session_id: string; station_id: string }>(res);
}

export async function transferStation(sessionId: string, targetStationId: string) {
  const res = await fetch(`${API_BASE}/admin/sessions/transfer`, {
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
  const res = await fetch(`${API_BASE}/admin/stations`, {
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
  const res = await fetch(`${API_BASE}/admin/stations/${stationId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return handleResponse<{ id: string; name: string; tier: string; hourly_rate: number; status: string; pricing_tiers?: PricingTier[] }>(res);
}

export async function deleteStation(stationId: string) {
  const res = await fetch(`${API_BASE}/admin/stations/${stationId}`, {
    method: 'DELETE',
  });
  if (res.status === 204) return;
  return handleResponse<void>(res);
}

export async function checkoutSession(sessionId: string, paymentMethod: 'CASH' | 'UPI'): Promise<CheckoutResult> {
  const idempotencyKey = `chk-${sessionId}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const res = await fetch(`${API_BASE}/admin/sessions/checkout`, {
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
  const res = await fetch(`${API_BASE}/admin/kitchen/orders`);
  return handleResponse<Order[]>(res);
}

export async function updateKitchenOrderStatus(orderId: string, status: OrderStatus): Promise<Order> {
  const res = await fetch(`${API_BASE}/admin/kitchen/orders/${orderId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  return handleResponse<Order>(res);
}

// Customer API
export async function fetchMenuItems(): Promise<MenuItem[]> {
  const res = await fetch(`${API_BASE}/customer/menu`);
  return handleResponse<MenuItem[]>(res);
}

export async function getCustomerToken(deskId: string, sessionId: string): Promise<{ access_token: string }> {
  const res = await fetch(`${API_BASE}/customer/auth/token`, {
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
  const res = await fetch(`${API_BASE}/customer/desk/session`, {
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
  const res = await fetch(`${API_BASE}/customer/order`, {
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
  const res = await fetch(`${API_BASE}/admin/menu`);
  return handleResponse<MenuItem[]>(res);
}

export async function createMenuItemApi(data: {
  name: string;
  category: string;
  price: number;
  stock?: number;
  min_stock_alert?: number;
  is_available?: boolean;
}): Promise<MenuItem> {
  const res = await fetch(`${API_BASE}/admin/menu`, {
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
  const res = await fetch(`${API_BASE}/admin/menu/${itemId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return handleResponse<MenuItem>(res);
}

export async function deleteMenuItemApi(itemId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/admin/menu/${itemId}`, {
    method: 'DELETE',
  });
  if (res.status === 204) return;
  return handleResponse<void>(res);
}

export async function restockMenuItemApi(itemId: string, amount: number): Promise<MenuItem> {
  const res = await fetch(`${API_BASE}/admin/inventory/restock`, {
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
  const res = await fetch(`${API_BASE}/admin/orders/station-order`, {
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
  const res = await fetch(`${API_BASE}/admin/customers`);
  return handleResponse<CustomerRecord[]>(res);
}
