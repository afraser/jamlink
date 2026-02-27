# JamLink — P2P Audio Streaming PoC

A browser-native, peer-to-peer audio streaming application built with **React**, **WebRTC**, and a lightweight **Node.js WebSocket signaling server**.

The host captures audio from any browser tab (Spotify, Deezer, Quobuz, YouTube, SoundCloud etc.) and streams it directly to connected listeners with no audio data passing through the server.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Signaling Server                        │
│              (WebSocket — metadata only)                    │
│   Routes: SDP offers/answers, ICE candidates, room codes    │
└──────────────┬──────────────────────────┬───────────────────┘
               │                          │
     ┌─────────▼───────────┐    ┌─────────▼──────────┐
     │       Host          │    │     Listener(s)    │
     │                     │    │                    │
     │  getDisplayMedia()  │◄───►  RTCPeerConnection │
     │  RTCPeerConnection  │    │  Web Audio API     │
     │  (OFFERER)          │    │  (ANSWERER)        │
     └─────────────────────┘    └────────────────────┘
            Audio flows directly P2P via WebRTC
```

### Key technical choices

| Concern          | Solution                                                                    |
| ---------------- | --------------------------------------------------------------------------- |
| Audio capture    | `getDisplayMedia({ video: false, audio: true })` — user picks a browser tab |
| P2P transport    | WebRTC `RTCPeerConnection` with audio-only tracks                           |
| Connection setup | WebSocket signaling server (Node.js + `ws`)                                 |
| NAT traversal    | Google STUN (`stun.l.google.com:19302`)                                     |
| Audio playback   | Web Audio API `GainNode` for volume control + waveform visualiser           |

---

## Getting Started

### Prerequisites

- Node.js ≥ 18
- A modern browser (Chrome/Edge recommended — best `getDisplayMedia` support)

### 1 — Start the signaling server

```bash
cd signaling-server
npm install
npm start
```

The server listens on `ws://localhost:8080` by default. Override with `PORT=9000 npm start`.

### 2 — Start the React client

```bash
cd client
npm install
npm run dev
```

Open **http://localhost:3000** in your browser.

### 3 — Stream audio

**Host browser:**

1. Click **"Host a Session"**
2. Wait for a 6-character room code (e.g. `K4X9QT`)
3. Click **"Start Capturing Tab Audio"**
4. In the browser picker, select the tab playing Spotify / Deezer / YouTube Music and **tick "Share tab audio"**
5. Share the room code with listeners

**Listener browser (same or different machine):**

1. Click **"Listen In"**
2. Enter the room code and click **Join**
3. Audio starts playing once the WebRTC handshake completes (~1–2 s)

---

## Project Structure

```
p2p-audio-poc/
├── signaling-server/
│   ├── package.json
│   └── server.js          ← WebSocket signaling (no audio ever passes here)
│
└── client/
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── App.jsx         ← Landing page + mode routing
        ├── App.css         ← Dark-theme design system
        ├── main.jsx
        ├── hooks/
        │   └── useSignaling.js   ← WebSocket connection hook
        └── components/
            ├── HostView.jsx      ← WebRTC OFFERER + audio capture
            ├── PeerView.jsx      ← WebRTC ANSWERER + audio playback
            └── AudioVisualizer.jsx ← AnalyserNode canvas waveform
```

---

## Configuration

### Custom signaling server URL

Set `VITE_SIGNALING_URL` before running the dev server:

```bash
VITE_SIGNALING_URL=wss://my-server.example.com npm run dev
```

### TURN server (for peers behind strict NAT/firewalls)

Edit the `ICE_SERVERS` constant in both `HostView.jsx` and `PeerView.jsx`:

```js
const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  {
    urls: "turn:your-turn-server.example.com:3478",
    username: "user",
    credential: "password",
  },
];
```

Free/cheap TURN options: [Metered](https://www.metered.ca/tools/openrelay/), [Twilio Network Traversal](https://www.twilio.com/docs/stun-turn), self-hosted [coturn](https://github.com/coturn/coturn).

---

## Known Limitations & Next Steps

### Audio capture

`getDisplayMedia()` only captures **browser tab audio**. For native desktop apps (Spotify app, iTunes, system output) you'd need:

- An **Electron** wrapper using `desktopCapturer` with loopback audio
- A **Tauri** app with system-audio permission
- A virtual audio device (e.g. BlackHole on macOS, VB-Cable on Windows) piped into a tab

### Scaling

Each listener requires a separate WebRTC connection from the host, so upstream bandwidth grows linearly. Practical limit is roughly **8–12 simultaneous listeners** on a typical home connection.

For larger audiences, replace the direct P2P model with an **SFU** (Selective Forwarding Unit):

- [mediasoup](https://mediasoup.org/) — self-hosted, production-grade
- [LiveKit](https://livekit.io/) — managed, generous free tier

### Other improvements

- Persistent room links (URL contains room code)
- Reconnect logic on transient network drops
- Latency measurement display
- Host mute/pause without dropping connections
- Listener chat via the signaling WebSocket
