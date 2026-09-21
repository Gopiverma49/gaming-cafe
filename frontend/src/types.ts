export type StationTier = 'STANDARD' | 'VIP' | 'SIMULATOR' | 'CONSOLE';

export type StationStatus = 'AVAILABLE' | 'OCCUPIED' | 'RESERVED' | 'MAINTENANCE';

export interface PricingTier {
  duration_min: number;
  price: number | string;
  label: string;
}

export interface StationLive {
  id: string;
  name: string;
  tier: StationTier;
  hourly_rate: string | number;
  default_hourly_rate?: number;
  pricing_tiers?: PricingTier[];
  status: StationStatus;
  active_session_id?: string | null;
  started_at?: string | null;
  elapsed_minutes: number;
  remaining_minutes?: number | null;
  time_charge: string | number;
  orders_charge: string | number;
  running_total: string | number;
  active_orders_count: number;
}

export interface MenuItem {
  id: string;
  name: string;
  category: string;
  price: string | number;
  is_available: boolean;
  stock?: number;
  min_stock_alert?: number;
  description?: string;
}

export type OrderStatus = 'QUEUED' | 'PREPARING' | 'SERVED' | 'CANCELLED';

export interface OrderItem {
  id: string;
  menu_item_id: string;
  menu_item_name: string;
  quantity: number;
  unit_price: string | number;
  subtotal: string | number;
}

export interface Order {
  id: string;
  session_id: string;
  station_name?: string;
  customer_name?: string;
  status: OrderStatus;
  created_at: string;
  items: OrderItem[];
  total_amount: string | number;
}

export interface CheckoutResult {
  session_id: string;
  payment_id: string;
  station_charge: string | number;
  time_charge?: string | number;
  orders_charge: string | number;
  total_amount: string | number;
  payment_method: 'CASH' | 'UPI';
  payment_status: string;
  upi_qr_string?: string | null;
  station_id?: string;
}

export interface CustomerDeskSession {
  session_id: string;
  station_id: string;
  station_name: string;
  tier: StationTier;
  hourly_rate: string | number;
  started_at: string;
  elapsed_minutes: number;
  allocated_minutes: number;
  remaining_minutes: number;
  time_charge: string | number;
  orders_charge: string | number;
  running_total: string | number;
  active_orders: Order[];
}

export interface TokenResponse {
  access_token: string;
  token_type?: string;
  scope?: string;
  expires_in?: number;
}

export interface AuthUser {
  id: string;
  name: string;
  phone: string;
  role: 'admin' | 'customer' | 'ADMIN' | 'CUSTOMER';
  created_at?: string;
}

export interface AuthTokenResponse {
  access_token: string;
  token_type: string;
  user: AuthUser;
}

export interface CustomerRecord {
  id: string;
  name: string;
  phone: string;
  visit_count: number;
  last_visit?: string | null;
  total_spent: number;
  notes?: string | null;
}

export interface WebSocketEvent {
  channel: string;
  event_type: 'SESSION_UPDATED' | 'SESSION_STARTED' | 'SESSION_COMPLETED' | 'SESSION_TRANSFERRED' | 'ORDER_STATUS_CHANGED' | 'ORDER_CREATED' | 'STATION_LOCKED';
  payload: any;
  timestamp: string;
}

export interface CustomerSessionRecord {
  id: string;
  stationId: string;
  stationName: string;
  customerName: string;
  customerPhone?: string | null;
  status: 'ACTIVE' | 'COMPLETED' | 'TRANSFERRED' | 'CANCELLED';
  startedAt: string;
  elapsedMinutes: number;
  durationMinutes?: number;
  hourlyRate: number;
  timeCharge: number;
  ordersCharge: number;
  totalCost: number;
}

export interface RevenueChartPoint {
  label: string;
  total: number;
  gaming: number;
  food: number;
}

export interface RevenueAnalyticsSummary {
  totalRevenue: number;
  gamingRevenue: number;
  foodRevenue: number;
  sessionsCount: number;
  averageSessionBill: number;
  topSellingItem: string;
  chartData: RevenueChartPoint[];
}

export type KitchenTicketStatus = 'pending' | 'preparing' | 'completed' | 'rejected';

export interface KitchenOrderItem {
  itemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  subtotal?: number;
}

export interface KitchenOrder {
  id: string;
  stationId: string;
  stationName: string;
  customerName: string;
  createdAt: number | string;
  status: KitchenTicketStatus;
  items: KitchenOrderItem[];
  totalAmount: number;
  rawOrder?: Order;
}

export interface InventoryItem {
  id: string;
  name: string;
  category: 'beverage' | 'snack' | string;
  stockQuantity: number;
  unitPrice: number;
}

