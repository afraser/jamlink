/**
 * JoinView
 *
 * Handles the /join-room route.
 * Lets the user type a room code and navigate to /listen/:roomId.
 * No signaling or WebRTC here — that all happens in ListenView.
 */

import { useState } from "react";
import { Link } from "react-router-dom";

export default function JoinView() {
  const [code, setCode] = useState("");

  const trimmedCode = code.trim().toUpperCase();
  const isValid = trimmedCode.length >= 4;

  return (
    <div className="view-container">
      <Link className="back-btn" to="/">
        ← Back
      </Link>

      <div className="card">
        <div className="info-row">
          <span className="card-title">Listener</span>
        </div>

        <p className="hint" style={{ marginBottom: 12 }}>
          Enter the 6-character room code shared by the host.
        </p>

        <div className="input-group">
          <input
            className="input"
            type="text"
            maxLength={6}
            placeholder="XXXXXX"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          {isValid ? (
            <Link className="btn btn-primary" to={`/listen/${trimmedCode}`}>
              Join
            </Link>
          ) : (
            <button className="btn btn-primary" disabled>
              Join
            </button>
          )}
        </div>
      </div>

      <div className="alert alert-info" style={{ marginTop: 0 }}>
        <strong>Privacy note:</strong> Audio streams directly from the host's
        browser to yours via WebRTC. The signaling server never relays audio
        data.
      </div>
    </div>
  );
}
