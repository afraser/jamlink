/**
 * useSignaling
 *
 * Manages the WebSocket connection to the signaling server.
 * Exposes a stable `send` function and fires `onMessage` callbacks.
 *
 * Usage:
 *   const { send, connected } = useSignaling(url, onMessage);
 */

import { useEffect, useRef, useCallback, useState } from 'react';

export function useSignaling(url, onMessage) {
  const wsRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const onMessageRef = useRef(onMessage);

  // Keep callback ref up-to-date without re-connecting
  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    if (!url) return;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[Signaling] Connected to', url);
      setConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        console.log('[Signaling] ←', msg.type, msg);
        onMessageRef.current?.(msg);
      } catch (e) {
        console.warn('[Signaling] Failed to parse message', e);
      }
    };

    ws.onclose = () => {
      console.log('[Signaling] Disconnected');
      setConnected(false);
    };

    ws.onerror = (err) => {
      console.error('[Signaling] Error', err);
    };

    return () => {
      ws.close();
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
