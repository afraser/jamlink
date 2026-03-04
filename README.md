# 🎵 JamLink — P2P Audio Streaming PoC

A browser-native, peer-to-peer audio streaming application built with **React**, **WebRTC**, and a lightweight **Node.js WebSocket signaling server**.

The host captures audio from any browser tab (Spotify, Deezer, Quobuz, YouTube, SoundCloud etc.) and streams it directly to connected listeners with no audio data passing through the server.

https://afraser.github.io/jamlink/

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

## Manual testing on a single machine

1. Start the client and server as described in this readme.
2. Play the audio you want to test in a new tab ("Source Tab") in the browser (eg: on SoundCloud).
3. Mute that tab via right click on the tab and click "mute this tab".
4. Open a 2nd tab ("Host Tab") to the JamLink client app and create a host to stream the Source Tab.
5. Open a 3rd tab ("Client Tab") pointed to the JamLink room you just created and play it. You should hear the audio even though the source tab is muted.
6. Congrats, you're now testing the listener experience. You can now compare the source audio to the client by unmuting the Source Tab and turning the volume down all the way on the Client Tab.

---

## Testing

Both test suites require **Node 24** (pinned via `.nvmrc` in each directory — run `nvm use` if you use nvm).

### Signaling server — integration tests

```bash
cd signaling-server
npm test
```

22 integration tests covering room creation, peer join/leave, host-left notifications, and edge cases. Uses Node's built-in `node:test` runner.

### Client — unit / component tests

```bash
cd client
pnpm test          # run once
pnpm test:watch    # watch mode
```

44 tests across 5 files:

| File | What it covers |
|------|----------------|
| `src/App.test.jsx` | Route rendering and navigation |
| `src/hooks/useSignaling.test.js` | WebSocket lifecycle, reconnect backoff |
| `src/components/HostView.test.jsx` | Signaling UI states, audio capture errors, WebRTC offer/ICE/answer flow |
| `src/components/PeerView.test.jsx` | Room join UI, auto-join from URL, WebRTC answer/ICE flow |
| `src/components/AudioVisualizer.test.jsx` | AudioContext setup and teardown |

Stack: [Vitest](https://vitest.dev/) + [@testing-library/react](https://testing-library.com/docs/react-testing-library/intro/).

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

### Audio Quality

What we can control:

```
┌───────────────────────┬────────────────────────────┬───────────────┐
│         Lever         │           Where            │ Current value │
├───────────────────────┼────────────────────────────┼───────────────┤
│ Mono vs stereo        │ SDP fmtp patch             │ stereo=0/1    │
├───────────────────────┼────────────────────────────┼───────────────┤
│ Echo cancellation     │ getDisplayMedia constraint │ false         │
├───────────────────────┼────────────────────────────┼───────────────┤
│ Noise suppression     │ getDisplayMedia constraint │ false         │
├───────────────────────┼────────────────────────────┼───────────────┤
│ Auto gain control     │ getDisplayMedia constraint │ false         │
├───────────────────────┼────────────────────────────┼───────────────┤
│ Sample rate (capture) │ getDisplayMedia constraint │ 48000 Hz      │
└───────────────────────┴────────────────────────────┴───────────────┘
```

What we don't control.

The biggest missing lever is bitrate. WebRTC browsers default to roughly 32 kbps mono / 64 kbps stereo for Opus, which is voice-call quality. For music that's pretty bad.

Other fmtp knobs worth knowing about:

```
┌───────────────────┬────────────────────────────────────┬─────────────────────────┐
│     Parameter     │            What it does            │  Good value for music   │
├───────────────────┼────────────────────────────────────┼─────────────────────────┤
│ maxaveragebitrate │ Opus target bitrate in bps         │ 320000 (320 kbps)       │
├───────────────────┼────────────────────────────────────┼─────────────────────────┤
│ maxplaybackrate   │ Decoder sample rate cap            │ 48000                   │
├───────────────────┼────────────────────────────────────┼─────────────────────────┤
│ usedtx            │ Discontinuous TX — mutes "silence" │ 0 (off — bad for music) │
├───────────────────┼────────────────────────────────────┼─────────────────────────┤
│ useinbandfec      │ In-band FEC for packet loss        │ 1                       │
├───────────────────┼────────────────────────────────────┼─────────────────────────┤
│ cbr               │ Constant vs variable bitrate       │ 0 (VBR, better quality) │
└───────────────────┴────────────────────────────────────┴─────────────────────────┘
```

### NAT traversal

> **In plain terms:** JamLink works best when both the host and listener are on typical home broadband. If a listener is on mobile data, a work/school network, or a VPN, their connection attempt may time out and fail. There's no workaround on the listener's end — the host needs a TURN server configured for those connections to succeed.

This app uses **STUN only** for ICE negotiation. STUN lets each peer discover its public IP/port, but the audio still flows directly P2P — which fails when the network won't allow it.

**Affected network types:**

- **Symmetric NAT** — common on corporate networks, university WiFi, and some home routers
- **CGNAT (Carrier-grade NAT)** — the norm on 4G/5G mobile connections

**Symptom:** the listener sees "Connection failed" after roughly 20 seconds (the browser's ICE timeout).

**Fix:** add a TURN server to `ICE_SERVERS` in both `HostView.jsx` and `PeerView.jsx`. A TURN server relays the audio through an intermediate host when a direct path can't be established. See the [TURN server configuration](#turn-server-for-peers-behind-strict-natfirewalls) section above for setup instructions and free/cheap provider options.

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
