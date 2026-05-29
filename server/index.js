const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT || 3478);
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const sessions = new Map();
const socketToSession = new Map();
const lastSeen = new Map();

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, sessions: sessions.size, uptime: process.uptime() });
});

function registerHeartbeat(socket) {
  lastSeen.set(socket.id, Date.now());
}

function cleanupSocket(socketId) {
  const sessionId = socketToSession.get(socketId);
  if (sessionId) {
    sessions.delete(sessionId);
    socketToSession.delete(socketId);
  }
  lastSeen.delete(socketId);
}

function emitToSession(sessionId, event, payload) {
  const targetSocketId = sessions.get(sessionId);
  if (!targetSocketId) {
    return false;
  }
  io.to(targetSocketId).emit(event, payload);
  return true;
}

io.on('connection', (socket) => {
  registerHeartbeat(socket);

  socket.on('register', ({ sessionId } = {}) => {
    if (!sessionId || !/^\d{9}$/.test(String(sessionId))) {
      socket.emit('error', { message: 'Invalid session ID.' });
      return;
    }

    const normalizedId = String(sessionId);
    const existingSocketId = sessions.get(normalizedId);
    if (existingSocketId && existingSocketId !== socket.id) {
      io.to(existingSocketId).emit('error', { message: 'This session was registered on another client.' });
      cleanupSocket(existingSocketId);
    }

    sessions.set(normalizedId, socket.id);
    socketToSession.set(socket.id, normalizedId);
    registerHeartbeat(socket);
    socket.emit('registered', { sessionId: normalizedId });
  });

  socket.on('heartbeat', () => {
    registerHeartbeat(socket);
  });

  socket.on('offer', ({ targetId, offer, from, password } = {}) => {
    registerHeartbeat(socket);
    if (!targetId || !offer || !from) {
      socket.emit('error', { message: 'Invalid offer payload.' });
      return;
    }
    if (!emitToSession(String(targetId), 'offer', { from, offer, password: password || '' })) {
      socket.emit('error', { message: 'Target session is offline.' });
    }
  });

  socket.on('answer', ({ targetId, answer, from } = {}) => {
    registerHeartbeat(socket);
    if (!targetId || !answer || !from) {
      socket.emit('error', { message: 'Invalid answer payload.' });
      return;
    }
    if (!emitToSession(String(targetId), 'answer', { answer, from })) {
      socket.emit('error', { message: 'Target session is offline.' });
    }
  });

  socket.on('ice', ({ targetId, candidate, from } = {}) => {
    registerHeartbeat(socket);
    if (!targetId || !candidate || !from) {
      socket.emit('error', { message: 'Invalid ICE payload.' });
      return;
    }
    if (!emitToSession(String(targetId), 'ice', { candidate, from })) {
      socket.emit('error', { message: 'Target session is offline.' });
    }
  });

  socket.on('reject', ({ targetId, reason, from } = {}) => {
    registerHeartbeat(socket);
    if (!targetId) {
      socket.emit('error', { message: 'Invalid reject payload.' });
      return;
    }
    if (!emitToSession(String(targetId), 'rejected', { reason: reason || 'Connection rejected.', from })) {
      socket.emit('error', { message: 'Target session is offline.' });
    }
  });

  socket.on('disconnect', () => {
    cleanupSocket(socket.id);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [socketId, seenAt] of lastSeen.entries()) {
    if (now - seenAt > 60000) {
      cleanupSocket(socketId);
      const staleSocket = io.sockets.sockets.get(socketId);
      if (staleSocket) {
        staleSocket.disconnect(true);
      }
    }
  }
}, 15000);

server.listen(PORT, () => {
  console.log(`Secure System signaling server listening on port ${PORT}`);
});
