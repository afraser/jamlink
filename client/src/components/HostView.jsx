/**
 * HostView
 *
 * Lets a user:
 *  1. Create a signaling room and share the room code with listeners
 *  2. Capture browser-tab audio via getDisplayMedia()
 *  3. Establish a WebRTC RTCPeerConnection for each peer that joins
 *  4. See which peers are connected and their ICE state
 *
 * WebRTC role: OFFERER (host always creates the offer)
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useSignaling } from "../hooks/useSignaling.js";
import AudioVisualizer from "./AudioVisualizer.jsx";

// Google's public STUN servers — good enough for most NAT configurations
const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

const SIGNALING_URL =
  import.meta.env.VITE_SIGNALING_URL || "ws://localhost:8080";

export default function HostView() {
  const navigate = useNavigate();
  const [roomId, setRoomId] = useState(null);
  const [stream, setStream] = useState(null);
  const [peers, setPeers] = useState({}); // peerId -> { pc, state }
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);

  // We store peer connections in a ref so signaling callbacks see fresh state
  const peerConnsRef = useRef({});
  const streamRef = useRef(null);

  // ── Signaling message handler ──────────────────────────────────────────────

  const handleSignalingMessage = useCallback(async (msg) => {
    switch (msg.type) {
      case "room-created": {
        setRoomId(msg.roomId);
        break;
      }

      case "peer-joined": {
        const { peerId } = msg;
        console.log(`[Host] Peer joined: ${peerId}`);
        // Kick off the WebRTC handshake with this new peer
        await createPeerConnection(peerId);
        break;
      }

      case "answer": {
        const { fromPeerId, sdp } = msg;
        const pc = peerConnsRef.current[fromPeerId]?.pc;
        if (pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        }
        break;
      }

      case "ice-candidate": {
        const { fromPeerId, candidate } = msg;
        const pc = peerConnsRef.current[fromPeerId]?.pc;
        if (pc && candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
        break;
      }

      case "peer-left": {
        const { peerId } = msg;
        closePeerConnection(peerId);
        break;
      }

      default:
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { send, connected } = useSignaling(
    SIGNALING_URL,
    handleSignalingMessage
  );

  // ── Clear room state when the signaling connection drops ──────────────────

  const prevConnectedRef = useRef(false);
  useEffect(() => {
    const wasConnected = prevConnectedRef.current;
    prevConnectedRef.current = connected;

    if (wasConnected && !connected) {
      // Connection dropped — clear stale room so we request a new one on reconnect
      setRoomId(null);
      Object.keys(peerConnsRef.current).forEach(closePeerConnection);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  // ── Create the room once we're connected ──────────────────────────────────

  useEffect(() => {
    if (connected && !roomId) {
      send({ type: "create-room" });
    }
  }, [connected, roomId, send]);

  // ── Tear down all connections on unmount ──────────────────────────────────

  useEffect(() => {
    return () => {
      Object.keys(peerConnsRef.current).forEach(closePeerConnection);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Audio capture ─────────────────────────────────────────────────────────

  const startCapture = useCallback(async () => {
    setError(null);
    try {
      const mediaStream = await navigator.mediaDevices.getDisplayMedia({
        // video: false, // audio-only capture — no video track needed
        video: { width: 1, height: 1 }, // Chrome requires this; we discard it
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: 48000,
        },
      });

      // Handle the user dismissing the picker without choosing
      mediaStream.getAudioTracks()[0]?.addEventListener("ended", stopCapture);

      streamRef.current = mediaStream;
      setStream(mediaStream);
      setIsCapturing(true);

      // Add the audio track to any already-connected peers
      Object.values(peerConnsRef.current).forEach(({ pc }) => {
        mediaStream.getAudioTracks().forEach((track) => {
          pc.addTrack(track, mediaStream);
        });
      });
    } catch (err) {
      if (err.name === "NotAllowedError") {
        setError(
          "Permission denied. Please allow tab audio sharing when prompted."
        );
      } else if (err.name === "NotFoundError") {
        setError(
          "No audio source found. Make sure you choose a tab with audio playing."
        );
      } else {
        setError(`Capture failed: ${err.message}`);
      }
    }
  }, []);

  const stopCapture = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
    setIsCapturing(false);
  }, []);

  // ── WebRTC peer connection management ──────────────────────────────────────

  const createPeerConnection = useCallback(
    async (peerId) => {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

      // Attach the current audio stream (if capture has already started)
      if (streamRef.current) {
        streamRef.current.getAudioTracks().forEach((track) => {
          pc.addTrack(track, streamRef.current);
        });
      }

      // Relay ICE candidates to the peer via the signaling server
      pc.onicecandidate = ({ candidate }) => {
        if (candidate) {
          send({ type: "ice-candidate", candidate, targetPeerId: peerId });
        }
      };

      // Track connection state for the UI
      pc.onconnectionstatechange = () => {
        console.log(`[Host] Peer ${peerId} state: ${pc.connectionState}`);
        setPeers((prev) => ({
          ...prev,
          [peerId]: { ...prev[peerId], state: pc.connectionState },
        }));

        if (
          pc.connectionState === "failed" ||
          pc.connectionState === "closed"
        ) {
          closePeerConnection(peerId);
        }
      };

      // Store the connection
      peerConnsRef.current[peerId] = { pc };
      setPeers((prev) => ({ ...prev, [peerId]: { state: "connecting" } }));

      // Create and send the offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      send({ type: "offer", sdp: pc.localDescription, targetPeerId: peerId });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [send]
  );

  const closePeerConnection = useCallback((peerId) => {
    peerConnsRef.current[peerId]?.pc.close();
    delete peerConnsRef.current[peerId];
    setPeers((prev) => {
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
  }, []);

  // ── Copy room code ─────────────────────────────────────────────────────────

  const copyRoomCode = () => {
    if (roomId) {
      const url = `${window.location.origin}${window.location.pathname}#/listen/${roomId}`;
      navigator.clipboard.writeText(url).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  // ── Derived state ──────────────────────────────────────────────────────────

  const peerEntries = Object.entries(peers);
  const connectedCount = peerEntries.filter(
    ([, p]) => p.state === "connected"
  ).length;

  const signalingStatus = !connected
    ? { label: "Connecting to server…", cls: "connecting" }
    : roomId
    ? {
        label: `Room ready · ${connectedCount} listener${
          connectedCount !== 1 ? "s" : ""
        }`,
        cls: "active",
      }
    : { label: "Creating room…", cls: "connecting" };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="view-container">
      <button className="back-btn" onClick={() => navigate("/")}>
        ← Back
      </button>

      {/* Status bar */}
      <div className="card">
        <div className="info-row">
          <span className="card-title">Host Session</span>
          <span className={`status-badge status-${signalingStatus.cls}`}>
            <span className="status-dot" />
            {signalingStatus.label}
          </span>
        </div>

        {/* Room code */}
        {roomId ? (
          <>
            <p className="hint" style={{ marginBottom: 8 }}>
              Share this link with listeners — it'll drop them straight into the
              session.
            </p>
            <div className="room-code-display">
              <span className="room-code">{roomId}</span>
              <button
                className={`copy-btn ${copied ? "copied" : ""}`}
                onClick={copyRoomCode}
              >
                {copied ? "✓ Copied" : "Copy link"}
              </button>
            </div>
          </>
        ) : (
          <p className="hint">Waiting for server…</p>
        )}
      </div>

      {/* Audio capture */}
      <div className="card">
        <div className="card-title">Audio Source</div>

        {!isCapturing ? (
          <>
            <button
              className="btn btn-primary btn-full"
              onClick={startCapture}
              disabled={!roomId}
            >
              🎵 Start Capturing Tab Audio
            </button>
            <p className="hint" style={{ marginTop: 10 }}>
              A browser picker will appear. Select the tab where Spotify /
              Deezer / YouTube Music is playing, and make sure{" "}
              <strong>"Share tab audio"</strong> is checked.
            </p>
          </>
        ) : (
          <>
            <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
              <span
                className="status-badge status-active"
                style={{ flex: 1, justifyContent: "center", padding: "8px 0" }}
              >
                <span className="status-dot" />
                Streaming audio live
              </span>
              <button className="btn btn-danger" onClick={stopCapture}>
                ⏹ Stop
              </button>
            </div>
            <AudioVisualizer stream={stream} />
          </>
        )}

        {error && <div className="alert alert-error">{error}</div>}
      </div>

      {/* Peer list */}
      <div className="card">
        <div className="card-title">Listeners ({peerEntries.length})</div>

        <div className="peer-list">
          {peerEntries.length === 0 ? (
            <div className="empty-peers">
              No listeners connected yet.
              <br />
              Share the room code above to invite people.
            </div>
          ) : (
            peerEntries.map(([peerId, peer]) => (
              <div className="peer-item" key={peerId}>
                <span className="peer-id">{peerId.slice(0, 16)}…</span>
                <span
                  className={`peer-state ${
                    peer.state === "connected"
                      ? "peer-state-connected"
                      : "peer-state-connecting"
                  }`}
                >
                  {peer.state}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Technical info */}
      <div className="alert alert-info" style={{ marginTop: 0 }}>
        <strong>How it works:</strong> Audio travels directly from your browser
        to each listener via WebRTC (P2P). This server only coordinates
        connection setup — it never sees your audio.
      </div>
    </div>
  );
}
