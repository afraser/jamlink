import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { useSignaling } from '../hooks/useSignaling.js';
import HostView from './HostView.jsx';

vi.mock('../hooks/useSignaling.js', () => ({
  useSignaling: vi.fn(),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

let mockSend;
let capturedOnMessage;

function renderHostView() {
  return render(
    <MemoryRouter initialEntries={['/host']}>
      <Routes>
        <Route path="/"     element={<div data-testid="landing" />} />
        <Route path="/host" element={<HostView />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockSend = vi.fn();
  useSignaling.mockImplementation((_url, onMessage) => {
    capturedOnMessage = onMessage;
    return { send: mockSend, connected: true };
  });
});

// ── Fake RTCPeerConnection for WebRTC tests ───────────────────────────────────

const FAKE_OFFER_SDP = { type: 'offer', sdp: 'v=0\r\no=fake 0 0 IN IP4 0.0.0.0\r\n' };
const FAKE_ANSWER_SDP = { type: 'answer', sdp: 'v=0\r\no=fake 1 0 IN IP4 0.0.0.0\r\n' };

function makeFakePC() {
  const pc = {
    localDescription: null,
    connectionState: 'new',
    onicecandidate: null,
    onconnectionstatechange: null,
    ontrack: null,
    createOffer: vi.fn(async () => FAKE_OFFER_SDP),
    setLocalDescription: vi.fn(async (desc) => { pc.localDescription = desc; }),
    setRemoteDescription: vi.fn(async () => {}),
    createAnswer: vi.fn(async () => FAKE_ANSWER_SDP),
    addIceCandidate: vi.fn(async () => {}),
    addTrack: vi.fn(),
    close: vi.fn(),
    // Test helper: fire an ICE candidate event
    _fireIce: (candidate) => pc.onicecandidate?.({ candidate }),
    // Test helper: change connection state
    _fireStateChange: (state) => {
      pc.connectionState = state;
      pc.onconnectionstatechange?.();
    },
  };
  return pc;
}

let fakePC;

function setupFakeRTC() {
  fakePC = makeFakePC();
  vi.stubGlobal('RTCPeerConnection', vi.fn(() => fakePC));
}

// ── Signaling / UI tests ──────────────────────────────────────────────────────

describe('HostView — signaling and UI', () => {
  test('shows "Connecting to server…" when connected=false', () => {
    useSignaling.mockReturnValue({ send: mockSend, connected: false });
    renderHostView();
    expect(screen.getByText('Connecting to server…')).toBeInTheDocument();
  });

  test('sends create-room once connected=true', () => {
    renderHostView();
    expect(mockSend).toHaveBeenCalledWith({ type: 'create-room' });
  });

  test('shows "Creating room…" after connected but before room-created', () => {
    renderHostView();
    expect(screen.getByText('Creating room…')).toBeInTheDocument();
  });

  test('shows room code and listener count after room-created', async () => {
    renderHostView();
    await act(async () => {
      await capturedOnMessage({ type: 'room-created', roomId: 'ABCDEF' });
    });
    expect(screen.getByText('ABCDEF')).toBeInTheDocument();
    expect(screen.getByText(/Room ready · 0 listeners/)).toBeInTheDocument();
  });

  test('copy button writes listen URL to clipboard', async () => {
    const user = userEvent.setup();
    const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    renderHostView();
    await act(async () => {
      await capturedOnMessage({ type: 'room-created', roomId: 'ABCDEF' });
    });
    await user.click(screen.getByRole('button', { name: /Copy link/i }));
    expect(writeTextSpy).toHaveBeenCalledWith(
      expect.stringContaining('#/listen/ABCDEF')
    );
  });

  test('"Start Capturing Tab Audio" is disabled until roomId is set', () => {
    renderHostView();
    expect(
      screen.getByRole('button', { name: /Start Capturing Tab Audio/i })
    ).toBeDisabled();
  });

  test('"Start Capturing Tab Audio" enabled after room-created', async () => {
    renderHostView();
    await act(async () => {
      await capturedOnMessage({ type: 'room-created', roomId: 'XYZABC' });
    });
    expect(
      screen.getByRole('button', { name: /Start Capturing Tab Audio/i })
    ).toBeEnabled();
  });

  test('clicking start capture calls navigator.mediaDevices.getDisplayMedia', async () => {
    const user = userEvent.setup();
    navigator.mediaDevices.getDisplayMedia.mockResolvedValue({
      getAudioTracks: () => [{ addEventListener: vi.fn() }],
      getTracks: () => [],
    });
    renderHostView();
    await act(async () => {
      await capturedOnMessage({ type: 'room-created', roomId: 'XYZABC' });
    });
    await user.click(screen.getByRole('button', { name: /Start Capturing Tab Audio/i }));
    expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalled();
  });

  test('shows error alert when capture is rejected with NotAllowedError', async () => {
    const user = userEvent.setup();
    const err = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    navigator.mediaDevices.getDisplayMedia.mockRejectedValue(err);
    renderHostView();
    await act(async () => {
      await capturedOnMessage({ type: 'room-created', roomId: 'XYZABC' });
    });
    await user.click(screen.getByRole('button', { name: /Start Capturing Tab Audio/i }));
    await waitFor(() =>
      expect(screen.getByText(/Permission denied/i)).toBeInTheDocument()
    );
  });

  test('back button navigates to /', async () => {
    const user = userEvent.setup();
    renderHostView();
    await user.click(screen.getByRole('button', { name: /← Back/i }));
    expect(screen.getByTestId('landing')).toBeInTheDocument();
  });
});

// ── WebRTC tests ──────────────────────────────────────────────────────────────

describe('HostView — WebRTC', () => {
  beforeEach(() => {
    setupFakeRTC();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('after peer-joined, sends an offer message with valid SDP', async () => {
    renderHostView();
    await act(async () => {
      await capturedOnMessage({ type: 'room-created', roomId: 'ROOM01' });
    });
    await act(async () => {
      await capturedOnMessage({ type: 'peer-joined', peerId: 'peer-1' });
    });

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'offer',
        sdp: FAKE_OFFER_SDP,
        targetPeerId: 'peer-1',
      })
    );
  });

  test('after peer-joined, sends ICE candidates via signaling', async () => {
    renderHostView();
    await act(async () => {
      await capturedOnMessage({ type: 'room-created', roomId: 'ROOM01' });
    });
    await act(async () => {
      await capturedOnMessage({ type: 'peer-joined', peerId: 'peer-1' });
    });

    const fakeCandidate = { candidate: 'candidate:1 1 UDP 2113667327 192.168.1.1 54321 typ host' };
    await act(async () => {
      fakePC._fireIce(fakeCandidate);
    });

    expect(mockSend).toHaveBeenCalledWith({
      type: 'ice-candidate',
      candidate: fakeCandidate,
      targetPeerId: 'peer-1',
    });
  });

  test('peer appears in listeners list after peer-joined', async () => {
    renderHostView();
    await act(async () => {
      await capturedOnMessage({ type: 'room-created', roomId: 'ROOM01' });
    });
    await act(async () => {
      await capturedOnMessage({ type: 'peer-joined', peerId: 'peer-abc-123-xyz-qrs' });
    });

    // peer-id is displayed truncated to 16 chars + '…'
    expect(screen.getByText(/peer-abc-123-xyz/)).toBeInTheDocument();
  });

  test('after peer-left, peer is removed from listeners list', async () => {
    renderHostView();
    await act(async () => {
      await capturedOnMessage({ type: 'room-created', roomId: 'ROOM01' });
    });
    await act(async () => {
      await capturedOnMessage({ type: 'peer-joined', peerId: 'peer-abc-123-xyz-qrs' });
    });
    expect(screen.getByText(/peer-abc-123-xyz/)).toBeInTheDocument();

    await act(async () => {
      await capturedOnMessage({ type: 'peer-left', peerId: 'peer-abc-123-xyz-qrs' });
    });
    expect(screen.queryByText(/peer-abc-123-xyz/)).not.toBeInTheDocument();
  });

  test('after answer message, setRemoteDescription is called on the peer connection', async () => {
    renderHostView();
    await act(async () => {
      await capturedOnMessage({ type: 'room-created', roomId: 'ROOM01' });
    });
    await act(async () => {
      await capturedOnMessage({ type: 'peer-joined', peerId: 'peer-1' });
    });
    await act(async () => {
      await capturedOnMessage({
        type: 'answer',
        fromPeerId: 'peer-1',
        sdp: FAKE_ANSWER_SDP,
      });
    });

    expect(fakePC.setRemoteDescription).toHaveBeenCalled();
  });

  test('connection state shown in listener list reflects RTCPeerConnection state', async () => {
    renderHostView();
    await act(async () => {
      await capturedOnMessage({ type: 'room-created', roomId: 'ROOM01' });
    });
    await act(async () => {
      await capturedOnMessage({ type: 'peer-joined', peerId: 'peer-1' });
    });

    await act(async () => {
      fakePC._fireStateChange('connected');
    });

    // The listener row shows "connected" state
    expect(screen.getByText('connected')).toBeInTheDocument();
    // And the room status updates to "1 listener"
    expect(screen.getByText(/Room ready · 1 listener/)).toBeInTheDocument();
  });
});
