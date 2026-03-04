import '@testing-library/jest-dom';

// ── Canvas stub ───────────────────────────────────────────────────────────────
// AudioVisualizer calls canvas.getContext('2d') — jsdom doesn't implement it.
HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  beginPath: vi.fn(),
  closePath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  fill: vi.fn(),
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 0,
  shadowBlur: 0,
  shadowColor: '',
}));

// ── AudioContext stub ─────────────────────────────────────────────────────────
const makeFakeSource = () => ({ connect: vi.fn(), disconnect: vi.fn() });
const makeFakeGain   = () => ({ gain: { value: 1 }, connect: vi.fn() });
const makeFakeAnalyser = () => ({
  fftSize: 1024,
  smoothingTimeConstant: 0.8,
  frequencyBinCount: 512,
  getFloatTimeDomainData: vi.fn(),
  connect: vi.fn(),
});

const makeFakeAudioCtx = () => {
  const source   = makeFakeSource();
  const gain     = makeFakeGain();
  const analyser = makeFakeAnalyser();
  return {
    createMediaStreamSource: vi.fn(() => source),
    createGain:              vi.fn(() => gain),
    createAnalyser:          vi.fn(() => analyser),
    resume:      vi.fn(() => Promise.resolve()),
    close:       vi.fn(() => Promise.resolve()),
    destination: {},
    state:       'running',
  };
};

window.AudioContext       = vi.fn(makeFakeAudioCtx);
window.webkitAudioContext = vi.fn(makeFakeAudioCtx);

// ── navigator.mediaDevices stub ───────────────────────────────────────────────
Object.defineProperty(navigator, 'mediaDevices', {
  value: { getDisplayMedia: vi.fn() },
  writable: true,
  configurable: true,
});

// ── requestAnimationFrame / cancelAnimationFrame stubs ───────────────────────
// Use a no-op: return a handle but never fire the callback.  This prevents the
// AudioVisualizer draw loop from running asynchronously and leaking timers.
window.requestAnimationFrame = vi.fn(() => 0);
window.cancelAnimationFrame  = vi.fn();

// ── RTCSessionDescription / RTCIceCandidate stubs ────────────────────────────
// Used in component code when passing SDP/ICE to RTCPeerConnection.
// WebRTC tests stub RTCPeerConnection per-test; these ensure constructor calls
// don't throw in non-WebRTC tests.
global.RTCSessionDescription = class RTCSessionDescription {
  constructor(init) { Object.assign(this, init); }
};
global.RTCIceCandidate = class RTCIceCandidate {
  constructor(init) { Object.assign(this, init); }
};

// ── Reset mock state between tests ───────────────────────────────────────────
afterEach(() => {
  vi.clearAllMocks();
});
