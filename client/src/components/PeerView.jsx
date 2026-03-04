/**
 * PeerView
 *
 * Lets a listener:
 *  1. Enter a room code and connect to the host's signaling room
 *  2. Receive the WebRTC audio stream offered by the host (ANSWERER role)
 *  3. Play the audio through the Web Audio API with volume control
 *  4. Visualise the incoming audio waveform
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { useSignaling } from "../hooks/useSignaling.js";
import AudioVisualizer from "./AudioVisualizer.jsx";

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

const SIGNALING_URL =
  import.meta.env.VITE_SIGNALING_URL || "ws://localhost:8080";

export default function PeerView() {
  const { roomId: initialRoomCode = null } = useParams();
  const [roomCodeInput, setRoomCodeInput] = useState(initialRoomCode || "");
  const [joinedRoom, setJoinedRoom] = useState(null);
  const autoJoinedRef = useRef(false);
  const [connectionState, setConnectionState] = useState("idle"); // idle | joining | connected | disconnected | error
  const [remoteStream, setRemoteStream] = useState(null);
  const [volume, setVolume] = useState(80);
  const [error, setError] = useState(null);
  const [audioSuspended, setAudioSuspended] = useState(false);

  const pcRef = useRef(null);
  const gainNodeRef = useRef(null);
  const audioCtxRef = useRef(null);
  const audioElRef = useRef(null);

  // ── Signaling message handler (must be declared before useSignaling) ────────

  const handleSignalingMessage = useCallback(async (msg) => {
    switch (msg.type) {
      case "room-joined": {
        setJoinedRoom(msg.roomId);
        setConnectionState("joining");
        break;
      }

      case "error": {
        setError(msg.message || "An error occurred.");
        setConnectionState("error");
        break;
      }

      // Host sent us a WebRTC offer — create an answer
      case "offer": {
        const { sdp } = msg;
        await handleOffer(sdp);
        break;
      }

      // ICE candidate from the host
      case "ice-candidate": {
        const { candidate } = msg;
        if (pcRef.current && candidate) {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        }
        break;
      }

      case "host-left": {
        setConnectionState("disconnected");
        setRemoteStream(null);
        setError("The host ended the session.");
        pcRef.current?.close();
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

  // ── Cleanup ────────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      pcRef.current?.close();
      audioCtxRef.current?.close();
    };
  }, []);

  // ── Auto-join when navigated to via URL ───────────────────────────────────

  useEffect(() => {
    if (initialRoomCode && connected && !autoJoinedRef.current) {
      autoJoinedRef.current = true;
      send({ type: "join-room", roomId: initialRoomCode });
    }
  }, [initialRoomCode, connected, send]);

  // ── Volume control ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = volume / 100;
    }
    if (audioElRef.current) {
      audioElRef.current.volume = volume / 100;
    }
  }, [volume]);

  // ── Join a room ────────────────────────────────────────────────────────────

  const joinRoom = useCallback(() => {
    const code = roomCodeInput.trim().toUpperCase();
    if (!code || code.length < 4) {
      setError("Please enter a valid room code.");
      return;
    }
    setError(null);
    setConnectionState("joining");
    send({ type: "join-room", roomId: code });
  }, [roomCodeInput, send]);

  // ── Handle WebRTC offer ────────────────────────────────────────────────────

  const handleOffer = useCallback(
    async (sdp) => {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pcRef.current = pc;

      // When we receive audio tracks from the host, set up playback
      pc.ontrack = (event) => {
        console.log("[Peer] Received remote track:", event.track.kind);
        if (event.streams && event.streams[0]) {
          const incomingStream = event.streams[0];
          setRemoteStream(incomingStream);
          playStream(incomingStream);
        }
      };

      // Send our ICE candidates back to the host
      pc.onicecandidate = ({ candidate }) => {
        if (candidate) {
          send({ type: "ice-candidate", candidate });
        }
      };

      pc.onconnectionstatechange = () => {
        console.log("[Peer] Connection state:", pc.connectionState);
        setConnectionState(pc.connectionState);
      };

      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      send({ type: "answer", sdp: pc.localDescription });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [send]
  );

  // ── Audio playback via Web Audio API ──────────────────────────────────────

  const playStream = useCallback((stream) => {
    // Create an AudioContext for volume control + visualisation
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const source = ctx.createMediaStreamSource(stream);
    const gainNode = ctx.createGain();
    gainNode.gain.value = volume / 100;

    source.connect(gainNode);
    gainNode.connect(ctx.destination);

    audioCtxRef.current = ctx;
    gainNodeRef.current = gainNode;

    // Browsers require a user gesture before AudioContext can produce sound.
    // If the peer arrived via a shared URL (no gesture on this page), the
    // context starts suspended. We attempt resume() here; if it stays
    // suspended the UI will show a "click to enable audio" button.
    ctx.resume().then(() => setAudioSuspended(false));
    if (ctx.state !== "running") setAudioSuspended(true);

    // Also attach to an <audio> element as a fallback / for mobile autoplay
    let el = audioElRef.current;
    if (!el) {
      el = new Audio();
      audioElRef.current = el;
    }
    el.srcObject = stream;
    el.volume = volume / 100;
    el.play().catch(() => {}); // best-effort; may be blocked by autoplay policy
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── UI helpers ─────────────────────────────────────────────────────────────

  const stateConfig = {
    idle: { label: "Not connected", cls: "idle" },
    joining: { label: "Joining room…", cls: "connecting" },
    new: { label: "Connecting…", cls: "connecting" },
    checking: { label: "Negotiating…", cls: "connecting" },
    connecting: { label: "Connecting…", cls: "connecting" },
    connected: { label: "Connected · Live", cls: "active" },
    disconnected: { label: "Disconnected", cls: "idle" },
    failed: { label: "Connection failed", cls: "error" },
    error: { label: "Error", cls: "error" },
    closed: { label: "Closed", cls: "idle" },
  };

  const status = stateConfig[connectionState] ?? {
    label: connectionState,
    cls: "idle",
  };
  const isConnected = connectionState === "connected";

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="view-container">
      <Link className="back-btn" to="/">
        ← Back
      </Link>

      {/* Connection status */}
      <div className="card">
        <div className="info-row">
          <span className="card-title">Listener</span>
          <span className={`status-badge status-${status.cls}`}>
            <span className="status-dot" />
            {status.label}
          </span>
        </div>

        {/* Room code entry */}
        {!joinedRoom ? (
          <>
            <p className="hint" style={{ marginBottom: 12 }}>
              Enter the 6-character room code shared by the host.
            </p>
            <div className="input-group">
              <input
                className="input"
                type="text"
                maxLength={6}
                placeholder="XXXXXX"
                value={roomCodeInput}
                onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && joinRoom()}
                disabled={!connected}
              />
              <button
                className="btn btn-primary"
                onClick={joinRoom}
                disabled={!connected || roomCodeInput.length < 4}
              >
                Join
              </button>
            </div>
            {!connected && (
              <p className="hint" style={{ marginTop: 8 }}>
                Connecting to signaling server…
              </p>
            )}
          </>
        ) : (
          <div className="room-code-display" style={{ marginTop: 0 }}>
            <div>
              <div className="hint" style={{ marginBottom: 4 }}>
                Room
              </div>
              <span className="room-code" style={{ fontSize: 22 }}>
                {joinedRoom}
              </span>
            </div>
            {isConnected && (
              <span className="status-badge status-active">
                <span className="status-dot" />
                Audio live
              </span>
            )}
          </div>
        )}

        {error && <div className="alert alert-error">{error}</div>}

        {joinedRoom && !isConnected && connectionState !== "error" && (
          <div className="alert alert-info" style={{ marginTop: 12 }}>
            Waiting for the host to offer a connection…
          </div>
        )}
      </div>

      {/* Audio playback + visualizer */}
      {isConnected && remoteStream && (
        <div className="card">
          <div className="card-title">Audio Playback</div>
          {audioSuspended ? (
            <button
              className="btn btn-primary btn-full"
              onClick={() =>
                audioCtxRef.current?.resume().then(() => {
                  setAudioSuspended(false);
                  audioElRef.current?.play().catch(() => {});
                })
              }
            >
              🔊 Click to enable audio
            </button>
          ) : (
            <AudioVisualizer stream={remoteStream} color="#34d399" />
          )}

          <div className="volume-row">
            <span className="volume-label">Volume</span>
            <input
              type="range"
              min={0}
              max={100}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
            />
            <span className="volume-value">{volume}%</span>
          </div>
        </div>
      )}

      {/* Info */}
      <div className="alert alert-info" style={{ marginTop: 0 }}>
        <strong>Privacy note:</strong> Audio streams directly from the host's
        browser to yours via WebRTC. The signaling server never relays audio
        data.
      </div>
    </div>
  );
}
