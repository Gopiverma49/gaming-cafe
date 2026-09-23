import { useEffect, useRef, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { WebSocketEvent } from '../types';

interface UseCafeWebSocketOptions {
  channel: string;
  onEvent?: (event: WebSocketEvent) => void;
}

export function useCafeWebSocket({ channel, onEvent }: UseCafeWebSocketOptions) {
  const queryClient = useQueryClient();
  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<WebSocketEvent | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const pingIntervalRef = useRef<number | null>(null);
  const isUnmountedRef = useRef(false);
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const debounceTimerRef = useRef<number | null>(null);
  const pendingKeysRef = useRef<Set<string>>(new Set());

  const triggerDebouncedInvalidate = useCallback((keys: string[]) => {
    keys.forEach((k) => pendingKeysRef.current.add(k));
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = window.setTimeout(() => {
      const keysToInvalidate = Array.from(pendingKeysRef.current);
      pendingKeysRef.current.clear();
      keysToInvalidate.forEach((k) => {
        queryClient.invalidateQueries({ queryKey: [k] });
      });
    }, 100);
  }, [queryClient]);

  const clearPingInterval = () => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
  };

  const connect = useCallback(() => {
    if (isUnmountedRef.current) return;

    // Build WebSocket URL
    let wsUrl: string;
    if (import.meta.env.VITE_WS_URL) {
      let baseWs = (import.meta.env.VITE_WS_URL as string).replace(/\/+$/, '');
      if (baseWs.startsWith('wsss://')) {
        baseWs = baseWs.replace(/^wsss:\/\//, 'wss://');
      } else if (baseWs.startsWith('https://')) {
        baseWs = baseWs.replace(/^https:\/\//, 'wss://');
      } else if (baseWs.startsWith('http://')) {
        baseWs = baseWs.replace(/^http:\/\//, 'ws://');
      }
      wsUrl = `${baseWs}/ws/${channel}`;
    } else {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      wsUrl = `${protocol}//${host}/ws/${channel}`;
    }

    try {
      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        reconnectAttemptRef.current = 0; // Reset backoff upon successful connection
        // Initial ping
        try {
          ws.send(JSON.stringify({ type: 'PING' }));
        } catch {}

        // Setup active keep-alive heartbeat every 15s to keep proxy & mobile connections alive
        clearPingInterval();
        pingIntervalRef.current = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            try {
              ws.send(JSON.stringify({ type: 'PING' }));
            } catch {}
          }
        }, 15000);
      };

      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          if (parsed.type === 'PONG') return;

          const wsEvent = parsed as WebSocketEvent;
          setLastEvent(wsEvent);
          if (onEventRef.current) {
            onEventRef.current(wsEvent);
          }

          // Debounced and coalesced query invalidations to prevent thundering herd / request spam
          switch (wsEvent.event_type) {
            case 'STATION_UPDATED':
            case 'SESSION_UPDATED':
            case 'SESSION_STARTED':
            case 'SESSION_COMPLETED':
            case 'SESSION_TRANSFERRED':
            case 'SESSION_CANCELLED':
            case 'STATION_LOCKED':
              triggerDebouncedInvalidate([
                'stations-live',
                'fleet-categories',
                'customer-sessions',
                'kitchen-orders',
                'admin-customers',
                'desk-session',
              ]);
              break;

            case 'ORDER_STATUS_CHANGED':
            case 'ORDER_CREATED':
              triggerDebouncedInvalidate([
                'kitchen-orders',
                'stations-live',
                'customer-sessions',
                'desk-session',
                'admin-menu',
                'admin-customers',
              ]);
              break;

            default:
              triggerDebouncedInvalidate(['stations-live', 'fleet-categories', 'customer-sessions']);
              break;
          }
        } catch {
          // Non-JSON frame
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        clearPingInterval();
        if (isUnmountedRef.current) return;

        // Exponential backoff: 1s initial, 30s ceiling
        const delay = Math.min(30000, 1000 * Math.pow(2, reconnectAttemptRef.current));
        reconnectAttemptRef.current += 1;

        reconnectTimeoutRef.current = window.setTimeout(() => {
          connect();
        }, delay);
      };

      ws.onerror = () => {
        clearPingInterval();
        ws.close();
      };
    } catch {
      clearPingInterval();
      // Reconnect after 3s on immediate constructor failure
      reconnectTimeoutRef.current = window.setTimeout(() => {
        connect();
      }, 3000);
    }
  }, [channel, queryClient]);

  useEffect(() => {
    isUnmountedRef.current = false;
    connect();

    return () => {
      isUnmountedRef.current = true;
      clearPingInterval();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, [connect]);

  return { isConnected, lastEvent };
}
