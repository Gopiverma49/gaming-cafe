import {
  StationLive,
  MenuItem,
  Order,
  OrderStatus,
  CheckoutResult,
  CustomerDeskSession,
} from './types';

const API_BASE = '/api/v1';

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

// Admin API
export async function fetchLiveStations(): Promise<StationLive[]> {
  const res = await fetch(`${API_BASE}/admin/stations/live`);
  return handleResponse<StationLive[]>(res);
}

export async function checkInStation(stationId: string, allocatedMinutes: number = 60) {
  const res = await fetch(`${API_BASE}/admin/sessions/check-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      station_id: stationId,
      allocated_minutes: allocatedMinutes,
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
