export type StationTier = 'STANDARD' | 'VIP' | 'SIMULATOR' | 'CONSOLE' | 'VR' | 'PC_RIG';

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
  is_occupied?: boolean;
  is_my_session?: boolean;
  user_id?: string | null;
  active_session_id?: string | null;
  started_at?: string | null;
  elapsed_minutes: number;
  remaining_minutes?: number | null;
  time_charge: string | number;
  orders_charge: string | number;
  running_total: string | number;
  active_orders_count: number;
  device_name?: string | null;
  allocated_console?: string | null;
  customer_phone?: string | null;
  customer_name?: string | null;
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
  event_type: 'SESSION_UPDATED' | 'SESSION_STARTED' | 'SESSION_COMPLETED' | 'SESSION_TRANSFERRED' | 'SESSION_CANCELLED' | 'ORDER_STATUS_CHANGED' | 'ORDER_CREATED' | 'STATION_LOCKED' | 'STATION_UPDATED';
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

export interface DeviceAvailability {
  id: string; // 'PS1' | 'PS2' | 'PS3' | 'VR1'
  name: string;
  is_occupied: boolean;
  current_session_id?: string | null;
  remaining_minutes?: number | null;
}

export interface CategoryAvailability {
  id: 'solo' | 'multiplayer' | 'car_sim' | 'vr_sim' | string;
  name: string;
  tier: string;
  supported_device_ids: string[];
  devices: DeviceAvailability[];
  total_units: number;
  available_units: number;
  is_available: boolean;
  hourly_rate: number;
  pricing_tiers?: PricingTier[];
}

export interface SessionStartPayload {
  category_id?: string;
  device_id?: string;
  mode?: string;
  station_id?: string;
  duration_minutes: number;
  customer_name?: string;
  customer_phone?: string;
  user_id?: string;
  tier_price?: number;
}

export interface SessionResponse {
  id: string;
  station_id: string;
  station_name?: string;
  station?: 'Solo' | 'Multiplayer' | 'Car Simulator' | 'VR' | string;
  console?: 'PS1' | 'PS2' | 'PS3' | 'VR1' | string;
  room?: 'PS1' | 'PS2' | 'PS3' | 'VR1' | string;
  started_at: string;
  ended_at?: string | null;
  status: string;
  total_amount: number | string;
  allocated_minutes?: number;
  tier_price?: number | string;
  category_id?: string;
  device_name?: string;
}

export interface MatrixSession {
  session_id: string;
  station_id: string;
  mode: string;
  mode_name: string;
  customer_name: string;
  customer_phone?: string | null;
  started_at: string;
  elapsed_minutes: number;
  remaining_minutes: number;
  allocated_minutes: number;
  time_charge: number;
  orders_charge: number;
  running_total: number;
  active_orders_count: number;
  hourly_rate: number;
  pricing_tiers: PricingTier[];
}

export interface MatrixStation {
  id: string;
  name: string;
  device_type: 'CONSOLE' | 'SIMULATOR' | 'VR' | string;
  status: 'AVAILABLE' | 'OCCUPIED' | 'MAINTENANCE';
  supported_modes: string[];
  active_session?: MatrixSession | null;
}

export interface MatrixMode {
  id: string;
  name: string;
  tier: string;
  hourly_rate: number;
  pricing_tiers: PricingTier[];
  supported_stations: string[];
}

export interface StationMatrixData {
  modes: MatrixMode[];
  stations: MatrixStation[];
  vr_session?: MatrixSession | null;
}


