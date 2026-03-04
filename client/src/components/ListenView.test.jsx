import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { useSignaling } from "../hooks/useSignaling.js";
import ListenView from "./ListenView.jsx";

vi.mock("../hooks/useSignaling.js", () => ({
  useSignaling: vi.fn(),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

let mockSend;
let capturedOnMessage;

function renderListenView(roomId = "ABCDEF") {
  return render(
    <MemoryRouter initialEntries={[`/listen/${roomId}`]}>
      <Routes>
        <Route path="/" element={<div data-testid="landing" />} />
        <Route path="/listen/:roomId" element={<ListenView />} />
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
    createAnswer: vi.fn(async () => FAKE_ANSWER_SDP),
    setLocalDescription: vi.fn(async (desc) => {
      pc.localDescription = desc;
    }),
    setRemoteDescription: vi.fn(async () => {}),
    addIceCandidate: vi.fn(async () => {}),
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

describe("ListenView — signaling and UI", () => {
  test("auto-sends join-room with roomId from URL once connected", () => {
    renderListenView("ABCXYZ");
    expect(mockSend).toHaveBeenCalledWith({
      type: "join-room",
      roomId: "ABCXYZ",
    });
  });

  test("displays the room code from the URL", () => {
    renderListenView("ABCXYZ");
    expect(screen.getByText("ABCXYZ")).toBeInTheDocument();
  });

  test('shows "Joining room…" after room-joined message', async () => {
    renderListenView();
    await act(async () => {
      await capturedOnMessage({ type: "room-joined", roomId: "ABCDEF" });
    });
    expect(screen.getByText("Joining room…")).toBeInTheDocument();
  });

  test("shows error alert after error message", async () => {
    renderListenView();
    await act(async () => {
      await capturedOnMessage({ type: "error", message: "Room not found." });
    });
    expect(screen.getByText("Room not found.")).toBeInTheDocument();
  });

  test('shows "The host ended the session." after host-left message', async () => {
    renderListenView();
    await act(async () => {
      await capturedOnMessage({ type: "room-joined", roomId: "ABCDEF" });
    });
    await act(async () => {
      await capturedOnMessage({ type: "host-left" });
    });
    expect(screen.getByText("The host ended the session.")).toBeInTheDocument();
  });

  test("back link navigates to /", async () => {
    const user = userEvent.setup();
    renderListenView();
    await user.click(screen.getByRole("link", { name: /← Back/i }));
    expect(screen.getByTestId("landing")).toBeInTheDocument();
  });
});

// ── WebRTC tests ──────────────────────────────────────────────────────────────

describe("ListenView — WebRTC", () => {
  beforeEach(() => {
    setupFakeRTC();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("after receiving an offer, component sends an answer with valid SDP", async () => {
    renderListenView();
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
    renderListenView();
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

  test("connectionState becomes connected in UI after state change", async () => {
    renderListenView();
    await act(async () => {
      await capturedOnMessage({ type: "room-joined", roomId: "ABCDEF" });
    });
    await act(async () => {
      await capturedOnMessage({ type: "offer", sdp: FAKE_OFFER_SDP });
    });

    await act(async () => {
      fakePC._fireStateChange("connected");
    });

    expect(screen.getByText("Connected · Live")).toBeInTheDocument();
  });
});
