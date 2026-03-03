"use strict";

const { describe, it, before, after, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { WebSocket } = require("ws");
const { server, wss, rooms, pingSweep } = require("./server");

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Resolve with the next parsed message received on ws, or reject on timeout. */
function nextMessage(ws, timeout = 1500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timed out waiting for message")),
      timeout
    );
    ws.once("message", (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data));
    });
  });
}

/** Open a WebSocket to the test server, resolve when connected. */
function connect(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

/** Close a client and wait for the client-side close event. */
function closeAndDrain(ws) {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) return setImmediate(resolve);
    ws.once("close", () => setImmediate(resolve));
    ws.close();
  });
}

/**
 * Poll until `condition()` returns truthy, or reject after `timeout` ms.
 * Use this when you need to assert server-side state after a disconnect,
 * since the server processes close frames asynchronously from the client.
 */
function waitFor(condition, timeout = 1000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout;
    (function check() {
      if (condition()) return resolve();
      if (Date.now() > deadline)
        return reject(
          new Error("waitFor: condition not met within " + timeout + "ms")
        );
      setTimeout(check, 10);
    })();
  });
}

function send(ws, payload) {
  ws.send(JSON.stringify(payload));
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

let port;

before(
  () =>
    new Promise((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => {
        port = server.address().port;
        resolve();
      });
      server.once("error", reject);
    })
);

after(
  () =>
    new Promise((resolve) => {
      // Terminate any lingering connections, close the WSS (which clears
      // the ping interval via wss.on('close')), then close the HTTP server.
      wss.clients.forEach((ws) => ws.terminate());
      wss.close(() => server.close(resolve));
    })
);

// Clean up any rooms left over between tests
afterEach(() => rooms.clear());

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("create-room", () => {
  it("responds with room-created containing a roomId and clientId", async () => {
    const host = await connect(port);
    send(host, { type: "create-room" });
    const msg = await nextMessage(host);
    assert.equal(msg.type, "room-created");
    assert.ok(msg.roomId, "roomId should be present");
    assert.ok(msg.clientId, "clientId should be present");
    await closeAndDrain(host);
  });

  it("adds the room to the rooms Map", async () => {
    const host = await connect(port);
    send(host, { type: "create-room" });
    const { roomId } = await nextMessage(host);
    assert.ok(rooms.has(roomId), "rooms Map should contain the new room");
    await closeAndDrain(host);
  });

  it("generates unique room IDs for concurrent hosts", async () => {
    const [h1, h2, h3] = await Promise.all([
      connect(port),
      connect(port),
      connect(port),
    ]);
    send(h1, { type: "create-room" });
    send(h2, { type: "create-room" });
    send(h3, { type: "create-room" });
    const [m1, m2, m3] = await Promise.all([
      nextMessage(h1),
      nextMessage(h2),
      nextMessage(h3),
    ]);
    const ids = [m1.roomId, m2.roomId, m3.roomId];
    assert.equal(new Set(ids).size, 3, "all room IDs should be unique");
    await Promise.all([h1, h2, h3].map(closeAndDrain));
  });

  // ── Memory-leak guard ──────────────────────────────────────────────────────
  it("cleans up the first room when host calls create-room a second time", async () => {
    const host = await connect(port);

    send(host, { type: "create-room" });
    const { roomId: firstRoomId } = await nextMessage(host);
    assert.ok(rooms.has(firstRoomId));

    send(host, { type: "create-room" });
    const { roomId: secondRoomId } = await nextMessage(host);

    assert.ok(rooms.has(secondRoomId), "second room should exist");
    assert.ok(
      !rooms.has(firstRoomId),
      "first room should have been deleted — not leaked"
    );
    assert.equal(rooms.size, 1);

    await closeAndDrain(host);
  });

  it("notifies peers in the abandoned first room when host creates a second room", async () => {
    const host = await connect(port);
    const peer = await connect(port);

    send(host, { type: "create-room" });
    const { roomId } = await nextMessage(host);

    send(peer, { type: "join-room", roomId });
    await nextMessage(peer); // room-joined
    await nextMessage(host); // peer-joined

    // Host creates a fresh room — peer should get host-left
    send(host, { type: "create-room" });
    const [hostLeftMsg] = await Promise.all([
      nextMessage(peer),
      nextMessage(host),
    ]);
    assert.equal(hostLeftMsg.type, "host-left");

    await Promise.all([host, peer].map(closeAndDrain));
  });
});

describe("join-room", () => {
  it("responds with room-joined and notifies the host", async () => {
    const host = await connect(port);
    send(host, { type: "create-room" });
    const { roomId } = await nextMessage(host);

    const peer = await connect(port);
    send(peer, { type: "join-room", roomId });

    const [peerMsg, hostMsg] = await Promise.all([
      nextMessage(peer),
      nextMessage(host),
    ]);
    assert.equal(peerMsg.type, "room-joined");
    assert.equal(peerMsg.roomId, roomId);
    assert.equal(hostMsg.type, "peer-joined");
    assert.ok(hostMsg.peerId);

    await Promise.all([host, peer].map(closeAndDrain));
  });

  it("adds the peer to room.peers", async () => {
    const host = await connect(port);
    send(host, { type: "create-room" });
    const { roomId } = await nextMessage(host);

    const peer = await connect(port);
    send(peer, { type: "join-room", roomId });
    const { clientId: peerId } = await nextMessage(peer);
    await nextMessage(host); // peer-joined

    assert.ok(rooms.get(roomId).peers.has(peerId));

    await Promise.all([host, peer].map(closeAndDrain));
  });

  it("returns an error for a non-existent room", async () => {
    const peer = await connect(port);
    send(peer, { type: "join-room", roomId: "DOESNT-EXIST" });
    const msg = await nextMessage(peer);
    assert.equal(msg.type, "error");
    await closeAndDrain(peer);
  });

  // ── Memory-leak guard ──────────────────────────────────────────────────────
  it("removes peer from the first room when they join a second room", async () => {
    const [h1, h2, peer] = await Promise.all([
      connect(port),
      connect(port),
      connect(port),
    ]);

    send(h1, { type: "create-room" });
    const { roomId: room1 } = await nextMessage(h1);

    send(h2, { type: "create-room" });
    const { roomId: room2 } = await nextMessage(h2);

    // Peer joins room 1
    send(peer, { type: "join-room", roomId: room1 });
    const { clientId: peerId } = await nextMessage(peer);
    await nextMessage(h1); // peer-joined

    assert.ok(rooms.get(room1).peers.has(peerId), "peer should be in room1");

    // Peer joins room 2 without explicitly leaving room 1
    send(peer, { type: "join-room", roomId: room2 });
    await nextMessage(peer); // room-joined
    await nextMessage(h2); // peer-joined

    assert.ok(
      !rooms.get(room1).peers.has(peerId),
      "peer should have been removed from room1 — not leaked"
    );
    assert.ok(rooms.get(room2).peers.has(peerId), "peer should be in room2");

    await Promise.all([h1, h2, peer].map(closeAndDrain));
  });
});

describe("signaling relay", () => {
  async function setupRoom() {
    const host = await connect(port);
    send(host, { type: "create-room" });
    const { roomId, clientId: hostId } = await nextMessage(host);

    const peer = await connect(port);
    send(peer, { type: "join-room", roomId });
    const { clientId: peerId } = await nextMessage(peer);
    await nextMessage(host); // peer-joined

    return { host, hostId, peer, peerId, roomId };
  }

  it("relays an offer from host to peer", async () => {
    const { host, peer, peerId, hostId } = await setupRoom();
    const sdp = { type: "offer", sdp: "v=0..." };

    send(host, { type: "offer", targetPeerId: peerId, sdp });
    const msg = await nextMessage(peer);

    assert.equal(msg.type, "offer");
    assert.deepEqual(msg.sdp, sdp);
    assert.equal(msg.fromPeerId, hostId);

    await Promise.all([host, peer].map(closeAndDrain));
  });

  it("relays an answer from peer to host", async () => {
    const { host, peer, peerId } = await setupRoom();
    const sdp = { type: "answer", sdp: "v=0..." };

    send(peer, { type: "answer", sdp });
    const msg = await nextMessage(host);

    assert.equal(msg.type, "answer");
    assert.deepEqual(msg.sdp, sdp);
    assert.equal(msg.fromPeerId, peerId);

    await Promise.all([host, peer].map(closeAndDrain));
  });

  it("relays an ICE candidate from host to a specific peer", async () => {
    const { host, peer, peerId, hostId } = await setupRoom();
    const candidate = { candidate: "candidate:...", sdpMid: "0" };

    send(host, { type: "ice-candidate", targetPeerId: peerId, candidate });
    const msg = await nextMessage(peer);

    assert.equal(msg.type, "ice-candidate");
    assert.deepEqual(msg.candidate, candidate);
    assert.equal(msg.fromPeerId, hostId);

    await Promise.all([host, peer].map(closeAndDrain));
  });

  it("relays an ICE candidate from peer to host", async () => {
    const { host, peer, peerId } = await setupRoom();
    const candidate = { candidate: "candidate:...", sdpMid: "0" };

    send(peer, { type: "ice-candidate", candidate });
    const msg = await nextMessage(host);

    assert.equal(msg.type, "ice-candidate");
    assert.deepEqual(msg.candidate, candidate);
    assert.equal(msg.fromPeerId, peerId);

    await Promise.all([host, peer].map(closeAndDrain));
  });
});

describe("disconnect cleanup", () => {
  it("deletes the room from rooms Map when host disconnects", async () => {
    const host = await connect(port);
    send(host, { type: "create-room" });
    const { roomId } = await nextMessage(host);
    assert.ok(rooms.has(roomId));

    host.close();
    await waitFor(() => !rooms.has(roomId));
    // If we reach here without timeout the room was cleaned up
  });

  it("notifies all peers with host-left when host disconnects", async () => {
    const host = await connect(port);
    send(host, { type: "create-room" });
    const { roomId } = await nextMessage(host);

    // Join peers sequentially to avoid message-ordering ambiguity
    const p1 = await connect(port);
    send(p1, { type: "join-room", roomId });
    await nextMessage(p1); // room-joined
    await nextMessage(host); // peer-joined

    const p2 = await connect(port);
    send(p2, { type: "join-room", roomId });
    await nextMessage(p2); // room-joined
    await nextMessage(host); // peer-joined

    // Confirm server state before triggering disconnect
    await waitFor(() => rooms.get(roomId)?.peers.size === 2);

    const p1Notified = nextMessage(p1);
    const p2Notified = nextMessage(p2);
    host.close();

    const [m1, m2] = await Promise.all([p1Notified, p2Notified]);
    assert.equal(m1.type, "host-left");
    assert.equal(m2.type, "host-left");

    await Promise.all([p1, p2].map(closeAndDrain));
  });

  it("removes the peer from room.peers when a peer disconnects", async () => {
    const host = await connect(port);
    send(host, { type: "create-room" });
    const { roomId } = await nextMessage(host);

    const peer = await connect(port);
    send(peer, { type: "join-room", roomId });
    const { clientId: peerId } = await nextMessage(peer);
    await nextMessage(host); // peer-joined

    assert.ok(rooms.get(roomId).peers.has(peerId));

    peer.close();
    await waitFor(() => !rooms.get(roomId)?.peers.has(peerId));
    // Reaching here means peer was removed from room.peers

    await closeAndDrain(host);
  });

  it("notifies host with peer-left when a peer disconnects", async () => {
    const host = await connect(port);
    send(host, { type: "create-room" });
    const { roomId } = await nextMessage(host);

    const peer = await connect(port);
    send(peer, { type: "join-room", roomId });
    const { clientId: peerId } = await nextMessage(peer);
    await nextMessage(host); // peer-joined

    const hostNotified = nextMessage(host);
    await closeAndDrain(peer);
    const msg = await hostNotified;

    assert.equal(msg.type, "peer-left");
    assert.equal(msg.peerId, peerId);

    await closeAndDrain(host);
  });

  it("does not crash when a peer disconnects after the host already left", async () => {
    const host = await connect(port);
    send(host, { type: "create-room" });
    const { roomId } = await nextMessage(host);

    const peer = await connect(port);
    send(peer, { type: "join-room", roomId });
    await nextMessage(peer); // room-joined
    await nextMessage(host); // peer-joined

    // Host leaves first — wait for server to process
    host.close();
    await waitFor(() => !rooms.has(roomId));

    // Peer disconnects — server must not throw
    peer.close();
    await new Promise((r) => setTimeout(r, 50)); // let server process
    // If we reach here without an unhandled exception the test passes
  });

  it("does not leave behind rooms when the last peer exits a room the host already left", async () => {
    const host = await connect(port);
    send(host, { type: "create-room" });
    const { roomId } = await nextMessage(host);

    const peer = await connect(port);
    send(peer, { type: "join-room", roomId });
    await nextMessage(peer);
    await nextMessage(host);

    await closeAndDrain(host);
    await closeAndDrain(peer);

    assert.equal(
      rooms.size,
      0,
      "no rooms should remain after everyone has left"
    );
  });
});

describe("keepalive", () => {
  it("sends a ping frame to each connected client", async () => {
    const client = await connect(port);
    const pingReceived = new Promise((resolve) => client.once("ping", resolve));
    pingSweep();
    await pingReceived;
    await closeAndDrain(client);
  });

  it("resets isAlive to true when a client responds to a ping", async () => {
    const client = await connect(port);
    pingSweep(); // sets isAlive=false, sends ping; client auto-pongs; handler sets isAlive=true
    await new Promise((r) => setTimeout(r, 50)); // let pong be processed
    wss.clients.forEach((ws) => {
      assert.equal(ws.isAlive, true, "isAlive should be true after pong");
    });
    await closeAndDrain(client);
  });

  it("terminates a client that did not respond to the previous ping", async () => {
    const client = await connect(port);
    // Simulate: the previous sweep sent a ping but no pong came back
    wss.clients.forEach((ws) => {
      ws.isAlive = false;
    });
    const closed = new Promise((resolve) => client.once("close", resolve));
    pingSweep();
    await closed; // client was terminated
  });

  it("cleans up room state when a host is terminated", async () => {
    const host = await connect(port);
    send(host, { type: "create-room" });
    const { roomId } = await nextMessage(host);

    wss.clients.forEach((ws) => {
      ws.isAlive = false;
    });
    pingSweep();

    await waitFor(() => !rooms.has(roomId));
  });

  it("notifies peers with host-left when host is terminated", async () => {
    const host = await connect(port);
    send(host, { type: "create-room" });
    const { roomId } = await nextMessage(host);

    const peer = await connect(port);
    send(peer, { type: "join-room", roomId });
    await nextMessage(peer); // room-joined
    await nextMessage(host); // peer-joined

    const hostLeftMsg = nextMessage(peer);

    // Mark only the host's server-side ws as dead, then sweep
    rooms.get(roomId).hostWs.isAlive = false;
    pingSweep();

    assert.equal((await hostLeftMsg).type, "host-left");
    await closeAndDrain(peer);
  });
});

describe("error handling", () => {
  it("ignores non-JSON messages without crashing", async () => {
    const client = await connect(port);
    client.send("this is not json");
    // Give the server a moment to process it, then verify it's still running
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(server.listening, "server should still be listening");
    await closeAndDrain(client);
  });

  it("ignores unknown message types without crashing", async () => {
    const client = await connect(port);
    send(client, { type: "totally-unknown-type" });
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(server.listening, "server should still be listening");
    await closeAndDrain(client);
  });

  it("does not crash when offer targets a non-existent peer", async () => {
    const host = await connect(port);
    send(host, { type: "create-room" });
    await nextMessage(host);

    send(host, { type: "offer", targetPeerId: "ghost-id", sdp: {} });
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(server.listening);

    await closeAndDrain(host);
  });
});
