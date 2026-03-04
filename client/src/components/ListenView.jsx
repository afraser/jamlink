/**
 * ListenView
 *
 * Handles the /listen/:roomId route.
 * Auto-joins the signaling room and receives the WebRTC audio stream
 * offered by the host (ANSWERER role).
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

export default function ListenView() {
  const { roomId } = useParams();
  const [connectionState, setConnectionState] = useState("idle");
  const [remoteStream, setRemoteStream] = useState(null);
  const [volume, setVolume] = useState(80);
  const [error, setError] = useState(null);
  const [audioSuspended, setAudioSuspended] = useState(false);

  const pcRef = useRef(null);
  const gainNodeRef = useRef(null);
  const audioCtxRef = useRef(null);
  const audioElRef = useRef(null);
  const autoJoinedRef = useRef(false);

  // ── Signaling message handler ──────────────────────────────────────────────

  const handleSignalingMessage = useCallback(async (msg) => {
    switch (msg.type) {
      case "room-joined": {
        setConnectionState("joining");
        break;
      }

      case "error": {
        setError(msg.message || "An error occurred.");
        setConnectionState("error");
        break;
      }

      case "offer": {
        await handleOffer(msg.sdp);
        break;
      }

      case "ice-candidate": {
        if (pcRef.current && msg.candidate) {
          await pcRef.current.addIceCandidate(
            new RTCIceCandidate(msg.candidate)
          );
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

  // ── Auto-join on mount ─────────────────────────────────────────────────────

  useEffect(() => {
    if (connected && !autoJoinedRef.current) {
      autoJoinedRef.current = true;
      send({ type: "join-room", roomId });
    }
  }, [connected, roomId, send]);

  // ── Volume control ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (gainNodeRef.current) gainNodeRef.current.gain.value = volume / 100;
    if (audioElRef.current) audioElRef.current.volume = volume / 100;
  }, [volume]);

  // ── Handle WebRTC offer ────────────────────────────────────────────────────

  const handleOffer = useCallback(
    async (sdp) => {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pcRef.current = pc;

      pc.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
          const incomingStream = event.streams[0];
          setRemoteStream(incomingStream);
          playStream(incomingStream);
        }
      };

      pc.onicecandidate = ({ candidate }) => {
        if (candidate) send({ type: "ice-candidate", candidate });
      };

      pc.onconnectionstatechange = () => {
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
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const source = ctx.createMediaStreamSource(stream);
    const gainNode = ctx.createGain();
    gainNode.gain.value = volume / 100;
    source.connect(gainNode);
    gainNode.connect(ctx.destination);

    audioCtxRef.current = ctx;
    gainNodeRef.current = gainNode;

    ctx.resume().then(() => setAudioSuspended(false));
    if (ctx.state !== "running") setAudioSuspended(true);

    let el = audioElRef.current;
    if (!el) {
      el = new Audio();
      audioElRef.current = el;
    }
    el.srcObject = stream;
    el.volume = volume / 100;
    el.play().catch(() => {});
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

      <div className="card">
        <div className="info-row">
          <span className="card-title">Listener</span>
          <span className={`status-badge status-${status.cls}`}>
            <span className="status-dot" />
            {status.label}
          </span>
        </div>

        <div className="room-code-display" style={{ marginTop: 0 }}>
          <div>
            <div className="hint" style={{ margin: "0 0 4px" }}>
              Room
            </div>
            <span className="room-code" style={{ fontSize: 22 }}>
              {roomId}
            </span>
          </div>
          {isConnected && (
            <span className="status-badge status-active">
              <span className="status-dot" />
              Audio live
            </span>
          )}
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        {!isConnected &&
          connectionState !== "error" &&
          connectionState !== "disconnected" && (
            <div className="alert alert-info" style={{ marginTop: 12 }}>
              Waiting for the host to offer a connection…
            </div>
          )}
      </div>

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

      <div className="alert alert-info" style={{ marginTop: 0 }}>
        <strong>Privacy note:</strong> Audio streams directly from the host's
        browser to yours via WebRTC. The signaling server never relays audio
        data.
      </div>
    </div>
  );
}
