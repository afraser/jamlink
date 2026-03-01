/**
 * P2P Audio Streaming — WebSocket Signaling Server
 *
 * Responsibilities:
 *  - Assign unique IDs to connecting clients
 *  - Create/destroy rooms keyed by a short human-readable code
 *  - Route SDP offers, answers, and ICE candidates between the host and peers
 *  - Notify peers when the host leaves and vice-versa
 *
 * Audio data NEVER passes through this server — it flows directly peer-to-peer
 * over WebRTC once the handshake is complete.
 */

const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const { v4: uuidv4 } = require('uuid');

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('ok');
});
const wss = new WebSocketServer({ server });

/**
 * rooms: Map<roomId, { hostWs: WebSocket, hostId: string, peers: Map<peerId, WebSocket> }>
 */
const rooms = new Map();

// Associate each WebSocket with a stable client ID
const clientMeta = new WeakMap(); // ws -> { clientId, roomId, isHost }

// ─── Helpers ────────────────────────────────────────────────────────────────

function send(ws, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

/** Generate a short, easy-to-share room code like "K4X9QT" */
function generateRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

// ─── Connection handler ──────────────────────────────────────────────────────

wss.on('connection', (ws) => {
  const clientId = uuidv4();
  clientMeta.set(ws, { clientId, roomId: null, isHost: false });

  console.log(`[+] Client connected: ${clientId}`);

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      console.warn('Received non-JSON message, ignoring.');
      return;
    }
    handleMessage(ws, msg);
  });

  ws.on('close', () => {
    handleDisconnect(ws);
  });

  ws.on('error', (err) => {
    console.error(`WebSocket error for ${clientId}:`, err.message);
  });
});

// ─── Message router ──────────────────────────────────────────────────────────

function handleMessage(ws, msg) {
  const meta = clientMeta.get(ws);
  if (!meta) return;

  console.log(`[MSG] ${meta.clientId} → type="${msg.type}"`);

  switch (msg.type) {

    // Host creates a new room
    case 'create-room': {
      // If this client already owns a room, tear it down first to avoid leaking it
      if (meta.roomId && meta.isHost) {
        const oldRoom = rooms.get(meta.roomId);
        if (oldRoom) {
          oldRoom.peers.forEach((peerWs) => send(peerWs, { type: 'host-left' }));
          rooms.delete(meta.roomId);
          console.log(`[ROOM] Destroyed previous room ${meta.roomId} (host re-created)`);
        }
      }

      let roomId = generateRoomId();
      // Avoid collision (extremely unlikely but safe)
      while (rooms.has(roomId)) roomId = generateRoomId();

      rooms.set(roomId, {
        hostWs: ws,
        hostId: meta.clientId,
        peers: new Map(),
      });

      meta.roomId = roomId;
      meta.isHost = true;

      send(ws, { type: 'room-created', roomId, clientId: meta.clientId });
      console.log(`[ROOM] Created: ${roomId} by host ${meta.clientId}`);
      break;
    }

    // Peer joins an existing room
    case 'join-room': {
      // If this peer is already in a room, leave it first to avoid leaking their entry
      if (meta.roomId && !meta.isHost) {
        const oldRoom = rooms.get(meta.roomId);
        if (oldRoom) {
          oldRoom.peers.delete(meta.clientId);
          send(oldRoom.hostWs, { type: 'peer-left', peerId: meta.clientId });
          console.log(`[ROOM] Peer ${meta.clientId} left previous room ${meta.roomId} (re-joined)`);
        }
      }

      const { roomId } = msg;
      const room = rooms.get(roomId);

      if (!room) {
        send(ws, { type: 'error', message: `Room "${roomId}" not found.` });
        return;
      }

      meta.roomId = roomId;
      meta.isHost = false;
      room.peers.set(meta.clientId, ws);

      // Confirm to the peer
      send(ws, { type: 'room-joined', roomId, clientId: meta.clientId });

      // Tell the host a new peer is waiting
      send(room.hostWs, { type: 'peer-joined', peerId: meta.clientId });

      console.log(`[ROOM] Peer ${meta.clientId} joined room ${roomId} (${room.peers.size} peer(s) total)`);
      break;
    }

    // Host → Peer: SDP offer
    case 'offer': {
      const { targetPeerId, sdp } = msg;
      const room = rooms.get(meta.roomId);
      if (!room) return;

      const peerWs = room.peers.get(targetPeerId);
      send(peerWs, { type: 'offer', sdp, fromPeerId: meta.clientId });
      break;
    }

    // Peer → Host: SDP answer
    case 'answer': {
      const { sdp } = msg;
      const room = rooms.get(meta.roomId);
      if (!room) return;

      send(room.hostWs, { type: 'answer', sdp, fromPeerId: meta.clientId });
      break;
    }

    // ICE candidate relay (bidirectional)
    case 'ice-candidate': {
      const { candidate, targetPeerId } = msg;
      const room = rooms.get(meta.roomId);
      if (!room) return;

      if (meta.isHost) {
        // Host sending ICE candidate to a specific peer
        const peerWs = room.peers.get(targetPeerId);
        send(peerWs, { type: 'ice-candidate', candidate, fromPeerId: meta.clientId });
      } else {
        // Peer sending ICE candidate back to host
        send(room.hostWs, { type: 'ice-candidate', candidate, fromPeerId: meta.clientId });
      }
      break;
    }

    default:
      console.warn(`Unknown message type: "${msg.type}"`);
  }
}

// ─── Disconnect handler ──────────────────────────────────────────────────────

function handleDisconnect(ws) {
  const meta = clientMeta.get(ws);
  if (!meta) return;

  console.log(`[-] Client disconnected: ${meta.clientId}`);

  if (meta.roomId) {
    const room = rooms.get(meta.roomId);
    if (!room) return;

    if (meta.isHost) {
      // Host left — notify all peers and tear down the room
      room.peers.forEach((peerWs) => {
        send(peerWs, { type: 'host-left' });
      });
      rooms.delete(meta.roomId);
      console.log(`[ROOM] Destroyed: ${meta.roomId} (host left)`);
    } else {
      // Peer left — remove from room, notify host
      room.peers.delete(meta.clientId);
      send(room.hostWs, { type: 'peer-left', peerId: meta.clientId });
      console.log(`[ROOM] Peer ${meta.clientId} left room ${meta.roomId}`);
    }
  }
}

// ─── Boot ────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const PORT = process.env.PORT || 8080;
  server.listen(PORT, () => console.log(`Signaling server listening on port ${PORT}`));
}

module.exports = { server, rooms };
