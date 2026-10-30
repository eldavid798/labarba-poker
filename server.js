'use strict';

const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const path     = require('path');
const { PokerRoom } = require('./gameEngine');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*' }
});

// ── Servir el cliente HTML ──────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Almacén de salas en memoria ────────────────────────────────
const rooms = {};  // { roomCode: PokerRoom }

function getOrCreateRoom(code, config) {
  if (!rooms[code]) rooms[code] = new PokerRoom(code, config);
  return rooms[code];
}

function broadcastRoom(room) {
  // Envía a cada socket una vista personalizada (oculta cartas ajenas)
  for (const [socketId, socket] of io.sockets.sockets) {
    const playerId = socket.playerId;
    if (socket.roomCode === room.code) {
      socket.emit('room:state', room.getStateFor(playerId));
    }
  }
}

// ── Conexión de socket ──────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[+] Conectado: ${socket.id}`);

  // ── Crear sala ──
  socket.on('room:create', ({ name, config }, cb) => {
    const code = Math.random().toString(36).slice(2,7).toUpperCase();
    const room = getOrCreateRoom(code, config);
    const res  = room.addPlayer(socket.id, name);
    if (!res.ok) return cb({ ok:false, reason: res.reason });

    socket.join(code);
    socket.roomCode  = code;
    socket.playerId  = socket.id;
    socket.playerName= name;

    console.log(`[ROOM] ${name} creó sala ${code}`);
    cb({ ok:true, code });
    broadcastRoom(room);
  });

  // ── Unirse a sala ──
  socket.on('room:join', ({ code, name }, cb) => {
    const room = rooms[code];
    if (!room) return cb({ ok:false, reason:'Sala no encontrada' });

    const res = room.addPlayer(socket.id, name);
    if (!res.ok) return cb({ ok:false, reason: res.reason });

    socket.join(code);
    socket.roomCode  = code;
    socket.playerId  = socket.id;
    socket.playerName= name;

    console.log(`[ROOM] ${name} entró a sala ${code}`);
    cb({ ok:true });
    broadcastRoom(room);
  });

  // ── Iniciar mano ──
  socket.on('game:startHand', (cb) => {
    const room = rooms[socket.roomCode];
    if (!room) return cb?.({ ok:false, reason:'No estás en una sala' });

    const res = room.startHand();
    if (!res.ok) return cb?.({ ok:false, reason: res.reason });

    console.log(`[GAME] Mano #${room.handNumber} en sala ${room.code}`);
    cb?.({ ok:true });
    broadcastRoom(room);

    // Notificar de quién empieza
    io.to(room.code).emit('game:yourTurn', {
      playerId: room.getActivePlayer()?.id
    });
  });

  // ── Acción de juego ──
  socket.on('game:action', ({ action, amount }, cb) => {
    const room = rooms[socket.roomCode];
    if (!room) return cb?.({ ok:false, reason:'No estás en una sala' });

    const res = room.playerAction(socket.playerId, action, amount);
    if (!res.ok) return cb?.({ ok:false, reason: res.reason });

    cb?.({ ok:true });
    broadcastRoom(room);

    if (res.stage !== 'showdown') {
      io.to(room.code).emit('game:yourTurn', {
        playerId: room.getActivePlayer()?.id
      });
    } else {
      io.to(room.code).emit('game:handOver', {
        winnerId: res.winner,
        handName: res.handName,
        won:      res.won
      });
    }
  });

  // ── Chat de sala ──
  socket.on('chat:message', (text) => {
    const room = rooms[socket.roomCode];
    if (!room) return;
    io.to(room.code).emit('chat:message', {
      from: socket.playerName,
      text,
      ts: Date.now()
    });
  });

  // ── Desconexión ──
  socket.on('disconnect', () => {
    const room = rooms[socket.roomCode];
    if (room) {
      room.removePlayer(socket.playerId);
      broadcastRoom(room);
    }
    console.log(`[-] Desconectado: ${socket.id}`);
  });
});

// ── Arrancar servidor ───────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🃏  La Barba Poker Room corriendo en http://localhost:${PORT}\n`);
});
