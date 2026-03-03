/**
 * useSignaling
 *
 * Manages the WebSocket connection to the signaling server.
 * Exposes a stable `send` function and fires `onMessage` callbacks.
 * Automatically reconnects with exponential backoff if the connection drops.
 *
 * Usage:
 *   const { send, connected } = useSignaling(url, onMessage);
 */

import { useEffect, useRef, useCallback, useState } from 'react';

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

export function useSignaling(url, onMessage) {
  const wsRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const onMessageRef = useRef(onMessage);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef(null);

  // Keep callback ref up-to-date without re-connecting
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    if (!url) return;

    let cancelled = false;

    function connect() {
      if (cancelled) return;

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) return;
        console.log('[Signaling] Connected to', url);
        retryCountRef.current = 0;
        setConnected(true);
      };

      ws.onmessage = (event) => {
        if (cancelled) return;
        try {
          const msg = JSON.parse(event.data);
          console.log('[Signaling] ←', msg.type, msg);
          onMessageRef.current?.(msg);
        } catch (e) {
          console.warn('[Signaling] Failed to parse message', e);
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        console.log('[Signaling] Disconnected');
        setConnected(false);

        const delay = Math.min(BASE_DELAY_MS * 2 ** retryCountRef.current, MAX_DELAY_MS);
        retryCountRef.current += 1;
        console.log(`[Signaling] Reconnecting in ${delay}ms (attempt ${retryCountRef.current})`);
        retryTimerRef.current = setTimeout(connect, delay);
      };

      ws.onerror = (err) => {
        if (cancelled) return;
        console.error('[Signaling] Error', err);
      };
    }

    connect();

    return () => {
      cancelled = true;
      clearTimeout(retryTimerRef.current);
      wsRef.current?.close();
    };
  }, [url]);

  const send = useCallback((payload) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      console.log('[Signaling] →', payload.type, payload);
      ws.send(JSON.stringify(payload));
    } else {
      console.warn('[Signaling] Cannot send — socket not open');
    }
  }, []);

  return { send, connected };
}
