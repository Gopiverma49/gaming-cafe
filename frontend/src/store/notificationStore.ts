import { create } from 'zustand';

export interface AdminNotification {
  id: string;
  type: 'BOOKING' | 'FOOD_ORDER' | 'MENU_CHANGE' | 'SYSTEM';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
}

interface NotificationState {
  notifications: AdminNotification[];
  activeToast: AdminNotification | null;
  addNotification: (type: AdminNotification['type'], title: string, message: string, silent?: boolean) => void;
  dismissToast: () => void;
  markAllAsRead: () => void;
  clearNotifications: () => void;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  activeToast: null,

  addNotification: (type, title, message, _silent = false) => {
    const newNotif: AdminNotification = {
      id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type,
      title,
      message,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      read: false,
    };

    set({
      notifications: [newNotif, ...get().notifications.slice(0, 49)],
      activeToast: null,
    });
  },

  dismissToast: () => set({ activeToast: null }),

  markAllAsRead: () => {
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
    }));
  },

  clearNotifications: () => set({ notifications: [], activeToast: null }),
}));
