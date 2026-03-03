import { renderHook, act } from '@testing-library/react';
import { useSignaling } from './useSignaling.js';

// ── Fake WebSocket ────────────────────────────────────────────────────────────

let wsInstances = [];

class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this._sent = [];
    this.closeCalled = false;
    wsInstances.push(this);
  }

  send(data) { this._sent.push(data); }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.closeCalled = true;
  }

  // Test helpers
  simulateOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  simulateMessage(data) {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) });
  }
  simulateClose() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
}

beforeEach(() => {
  wsInstances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

test('opens a WebSocket to the given URL on mount', () => {
  renderHook(() => useSignaling('ws://test.local', vi.fn()));
  expect(wsInstances).toHaveLength(1);
  expect(wsInstances[0].url).toBe('ws://test.local');
});

test('connected starts false, becomes true after onopen fires', async () => {
  const { result } = renderHook(() => useSignaling('ws://test.local', vi.fn()));
  expect(result.current.connected).toBe(false);

  await act(async () => { wsInstances[0].simulateOpen(); });

  expect(result.current.connected).toBe(true);
});

test('onMessage callback called with parsed object when onmessage fires', async () => {
  const onMessage = vi.fn();
  renderHook(() => useSignaling('ws://test.local', onMessage));

  await act(async () => { wsInstances[0].simulateOpen(); });
  await act(async () => {
    wsInstances[0].simulateMessage({ type: 'room-created', roomId: 'ABC' });
  });

  expect(onMessage).toHaveBeenCalledWith({ type: 'room-created', roomId: 'ABC' });
});

test('connected becomes false when onclose fires', async () => {
  const { result } = renderHook(() => useSignaling('ws://test.local', vi.fn()));

  await act(async () => { wsInstances[0].simulateOpen(); });
  expect(result.current.connected).toBe(true);

  await act(async () => { wsInstances[0].simulateClose(); });
  expect(result.current.connected).toBe(false);
});

test('send() calls ws.send(JSON.stringify(payload)) when connected', async () => {
  const { result } = renderHook(() => useSignaling('ws://test.local', vi.fn()));
  await act(async () => { wsInstances[0].simulateOpen(); });

  act(() => { result.current.send({ type: 'create-room' }); });

  expect(wsInstances[0]._sent).toContain(JSON.stringify({ type: 'create-room' }));
});

test('send() logs a console warning when not connected', () => {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const { result } = renderHook(() => useSignaling('ws://test.local', vi.fn()));
  // Don't open — readyState stays CONNECTING

  act(() => { result.current.send({ type: 'test' }); });

  expect(warnSpy).toHaveBeenCalled();
});

test('after onclose, schedules a reconnect (advance fake timers)', async () => {
  vi.useFakeTimers();

  const { result } = renderHook(() => useSignaling('ws://test.local', vi.fn()));
  await act(async () => { wsInstances[0].simulateOpen(); });
  await act(async () => { wsInstances[0].simulateClose(); });

  // Not yet reconnected
  expect(wsInstances).toHaveLength(1);

  // First retry delay is 1000ms
  await act(async () => { vi.advanceTimersByTime(1100); });

  expect(wsInstances).toHaveLength(2);
  expect(wsInstances[1].url).toBe('ws://test.local');

  // Stop fake timers to avoid bleeding into other tests
  vi.useRealTimers();
});

test('WebSocket is closed and reconnect timer cleared on unmount', async () => {
  vi.useFakeTimers();

  const { result, unmount } = renderHook(() => useSignaling('ws://test.local', vi.fn()));
  await act(async () => { wsInstances[0].simulateOpen(); });

  unmount();

  expect(wsInstances[0].closeCalled).toBe(true);

  // Advance past the retry delay — no new connection should appear
  await act(async () => { vi.advanceTimersByTime(5000); });
  expect(wsInstances).toHaveLength(1);

  vi.useRealTimers();
});
