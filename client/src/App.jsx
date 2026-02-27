import { useState } from "react";
import HostView from "./components/HostView.jsx";
import PeerView from "./components/PeerView.jsx";

export default function App() {
  // 'landing' | 'host' | 'peer'
  const [mode, setMode] = useState("landing");

  return (
    <div className="app">
      <header className="header">
        <div
          className="logo"
          onClick={() => setMode("landing")}
          style={{ cursor: "pointer" }}
        >
          <div className="logo-icon">🎵</div>
          JamLink
        </div>
      </header>

      <main className="main">
        {mode === "landing" && (
          <div className="landing">
            <h1>Stream Audio, Peer-to-Peer</h1>
            <p>
              Share music from Spotify, Deezer, or any browser tab directly to
              your friends — no middle server, no delay, no accounts required.
            </p>

            <div className="landing-cards">
              <div className="landing-card" onClick={() => setMode("host")}>
                <div className="landing-card-icon">📡</div>
                <h3>Host a Session</h3>
                <p>Capture and broadcast tab audio to connected listeners</p>
              </div>

              <div className="landing-card" onClick={() => setMode("peer")}>
                <div className="landing-card-icon">🎧</div>
                <h3>Listen In</h3>
                <p>Join a session with a room code and hear the stream live</p>
              </div>
            </div>

            <div
              className="alert alert-info"
              style={{ marginTop: 28, textAlign: "left", fontSize: 12 }}
            >
              <strong>Browser audio capture</strong> works best when
              Spotify/Deezer is open in a <em>browser tab</em> (Web Player). For
              the native desktop app, an Electron wrapper with system audio
              access is required.
            </div>
          </div>
        )}

        {mode === "host" && <HostView onBack={() => setMode("landing")} />}
        {mode === "peer" && <PeerView onBack={() => setMode("landing")} />}
      </main>
    </div>
  );
}
