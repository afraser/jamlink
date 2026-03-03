import { Routes, Route, useNavigate } from "react-router-dom";
import HostView from "./components/HostView.jsx";
import PeerView from "./components/PeerView.jsx";

function Landing() {
  const navigate = useNavigate();
  return (
    <div className="landing">
      <h1>Stream Audio, Peer-to-Peer</h1>
      <p>
        Share music from Spotify, Deezer, or any browser tab directly to
        your friends — no middle server, no delay, no accounts required.
      </p>

      <div className="landing-cards">
        <div className="landing-card" onClick={() => navigate("/host")}>
          <div className="landing-card-icon">📡</div>
          <h3>Host a Session</h3>
          <p>Capture and broadcast tab audio to connected listeners</p>
        </div>

        <div className="landing-card" onClick={() => navigate("/join-room")}>
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
  );
}

export default function App() {
  const navigate = useNavigate();

  return (
    <div className="app">
      <header className="header">
        <div
          className="logo"
          onClick={() => navigate("/")}
          style={{ cursor: "pointer" }}
        >
          <div className="logo-icon">🎵</div>
          JamLink
        </div>
      </header>

      <main className="main">
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/host" element={<HostView />} />
          <Route path="/join-room" element={<PeerView />} />
          <Route path="/listen/:roomId" element={<PeerView />} />
        </Routes>
      </main>
    </div>
  );
}
