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
  const isUnmountedRef = useRef(false);

  const connect = useCallback(() => {
    if (isUnmountedRef.current) return;

    // Build WebSocket URL
    let wsUrl: string;
    if (import.meta.env.VITE_WS_URL) {
      const baseWs = (import.meta.env.VITE_WS_URL as string).replace(/\/+$/, '');
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
        // Optional ping
        ws.send(JSON.stringify({ type: 'PING' }));
      };

      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          if (parsed.type === 'PONG') return;

          const wsEvent = parsed as WebSocketEvent;
          setLastEvent(wsEvent);
          if (onEvent) {
            onEvent(wsEvent);
          }

          // Automatically invalidate TanStack Query cache keys based on event_type
          switch (wsEvent.event_type) {
            case 'SESSION_UPDATED':
            case 'SESSION_STARTED':
            case 'SESSION_COMPLETED':
            case 'SESSION_TRANSFERRED':
              queryClient.invalidateQueries({ queryKey: ['stations-live'] });
              queryClient.invalidateQueries({ queryKey: ['desk-session'] });
              break;

            case 'ORDER_STATUS_CHANGED':
            case 'ORDER_CREATED':
              queryClient.invalidateQueries({ queryKey: ['kitchen-orders'] });
              queryClient.invalidateQueries({ queryKey: ['stations-live'] });
              queryClient.invalidateQueries({ queryKey: ['desk-session'] });
              break;

            case 'STATION_LOCKED':
              queryClient.invalidateQueries({ queryKey: ['stations-live'] });
              queryClient.invalidateQueries({ queryKey: ['desk-session'] });
              break;

            default:
              break;
          }
        } catch {
          // Non-JSON frame
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        if (isUnmountedRef.current) return;

        // Exponential backoff: 1s initial, 30s ceiling
        // delay = min(30000, 1000 * 2^attempt)
        const delay = Math.min(30000, 1000 * Math.pow(2, reconnectAttemptRef.current));
        reconnectAttemptRef.current += 1;

        reconnectTimeoutRef.current = window.setTimeout(() => {
          connect();
        }, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      // Reconnect after 3s on immediate constructor failure
      reconnectTimeoutRef.current = window.setTimeout(() => {
        connect();
      }, 3000);
    }
  }, [channel, onEvent, queryClient]);

  useEffect(() => {
    isUnmountedRef.current = false;
    connect();

    return () => {
      isUnmountedRef.current = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, [connect]);

  return { isConnected, lastEvent };
}
