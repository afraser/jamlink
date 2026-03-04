import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { useSignaling } from "../hooks/useSignaling.js";
import PeerView from "./PeerView.jsx";

vi.mock("../hooks/useSignaling.js", () => ({
  useSignaling: vi.fn(),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

let mockSend;
let capturedOnMessage;

function renderPeerView(path = "/join-room") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<div data-testid="landing" />} />
        <Route path="/join-room" element={<PeerView />} />
        <Route path="/listen/:roomId" element={<PeerView />} />
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

const FAKE_OFFER_SDP = {
  type: "offer",
  sdp: "v=0\r\no=fake 0 0 IN IP4 0.0.0.0\r\n",
};
const FAKE_ANSWER_SDP = {
  type: "answer",
  sdp: "v=0\r\no=fake 1 0 IN IP4 0.0.0.0\r\n",
};

function makeFakePC() {
  const pc = {
    localDescription: null,
    connectionState: "new",
    onicecandidate: null,
    onconnectionstatechange: null,
    ontrack: null,
    createOffer: vi.fn(async () => FAKE_OFFER_SDP),
    setLocalDescription: vi.fn(async (desc) => {
      pc.localDescription = desc;
    }),
    setRemoteDescription: vi.fn(async () => {}),
    createAnswer: vi.fn(async () => FAKE_ANSWER_SDP),
    addIceCandidate: vi.fn(async () => {}),
    addTrack: vi.fn(),
    close: vi.fn(),
    _fireIce: (candidate) => pc.onicecandidate?.({ candidate }),
    _fireStateChange: (state) => {
      pc.connectionState = state;
      pc.onconnectionstatechange?.();
    },
    _fireTrack: (track, stream) => {
      pc.ontrack?.({ track, streams: [stream] });
    },
  };
  return pc;
}

let fakePC;

function setupFakeRTC() {
  fakePC = makeFakePC();
  vi.stubGlobal(
    "RTCPeerConnection",
    vi.fn(() => fakePC)
  );
}

// ── Signaling / UI tests ──────────────────────────────────────────────────────

describe("PeerView — signaling and UI", () => {
  test("on /join-room: room code input renders empty", () => {
    renderPeerView("/join-room");
    expect(screen.getByPlaceholderText("XXXXXX")).toHaveValue("");
  });

  test("on /listen/ABCXYZ: input is pre-filled with ABCXYZ", () => {
    renderPeerView("/listen/ABCXYZ");
    expect(screen.getByDisplayValue("ABCXYZ")).toBeInTheDocument();
  });

  test("on /listen/ABCXYZ: auto-sends join-room once connected=true", () => {
    renderPeerView("/listen/ABCXYZ");
    expect(mockSend).toHaveBeenCalledWith({
      type: "join-room",
      roomId: "ABCXYZ",
    });
  });

  test("Join button is disabled when input has fewer than 4 chars", async () => {
    const user = userEvent.setup();
    renderPeerView("/join-room");
    const input = screen.getByPlaceholderText("XXXXXX");
    await user.type(input, "AB");
    expect(screen.getByRole("button", { name: "Join" })).toBeDisabled();
  });

  test("typing a code and clicking Join sends join-room message", async () => {
    const user = userEvent.setup();
    renderPeerView("/join-room");
    await user.type(screen.getByPlaceholderText("XXXXXX"), "ABCDEF");
    await user.click(screen.getByRole("button", { name: "Join" }));
    expect(mockSend).toHaveBeenCalledWith({
      type: "join-room",
      roomId: "ABCDEF",
    });
  });

  test('shows "Joining room…" after room-joined message', async () => {
    renderPeerView("/join-room");
    await act(async () => {
      await capturedOnMessage({ type: "room-joined", roomId: "ABCDEF" });
    });
    expect(screen.getByText("Joining room…")).toBeInTheDocument();
  });

  test("shows error alert after error message", async () => {
    renderPeerView("/join-room");
    await act(async () => {
      await capturedOnMessage({ type: "error", message: "Room not found." });
    });
    expect(screen.getByText("Room not found.")).toBeInTheDocument();
  });

  test('shows "The host ended the session." after host-left message', async () => {
    renderPeerView("/join-room");
    await act(async () => {
      await capturedOnMessage({ type: "room-joined", roomId: "ABCDEF" });
    });
    await act(async () => {
      await capturedOnMessage({ type: "host-left" });
    });
    expect(screen.getByText("The host ended the session.")).toBeInTheDocument();
  });

  test("back button navigates to /", async () => {
    const user = userEvent.setup();
    renderPeerView("/join-room");
    await user.click(screen.getByRole("link", { name: /← Back/i }));
    expect(screen.getByTestId("landing")).toBeInTheDocument();
  });
});

// ── WebRTC tests ──────────────────────────────────────────────────────────────

describe("PeerView — WebRTC", () => {
  beforeEach(() => {
    setupFakeRTC();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("after receiving an offer, component sends an answer with valid SDP", async () => {
    renderPeerView("/join-room");
    await act(async () => {
      await capturedOnMessage({ type: "room-joined", roomId: "ABCDEF" });
    });
    await act(async () => {
      await capturedOnMessage({ type: "offer", sdp: FAKE_OFFER_SDP });
    });

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "answer",
        sdp: FAKE_ANSWER_SDP,
      })
    );
  });

  test("component sends ICE candidates back to host via signaling", async () => {
    renderPeerView("/join-room");
    await act(async () => {
      await capturedOnMessage({ type: "room-joined", roomId: "ABCDEF" });
    });
    await act(async () => {
      await capturedOnMessage({ type: "offer", sdp: FAKE_OFFER_SDP });
    });

    const fakeCandidate = {
      candidate: "candidate:1 1 UDP 2113667327 192.168.1.1 12345 typ host",
    };
    await act(async () => {
      fakePC._fireIce(fakeCandidate);
    });

    expect(mockSend).toHaveBeenCalledWith({
      type: "ice-candidate",
      candidate: fakeCandidate,
    });
  });

  test("ontrack fires → connectionState becomes connected in UI", async () => {
    renderPeerView("/join-room");
    await act(async () => {
      await capturedOnMessage({ type: "room-joined", roomId: "ABCDEF" });
    });
    await act(async () => {
      await capturedOnMessage({ type: "offer", sdp: FAKE_OFFER_SDP });
    });

    // Simulate the RTCPeerConnection reaching 'connected' state
    await act(async () => {
      fakePC._fireStateChange("connected");
    });

    // Status badge should now show "Connected · Live"
    expect(screen.getByText("Connected · Live")).toBeInTheDocument();
  });
});
