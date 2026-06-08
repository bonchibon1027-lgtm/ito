const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/terms',   (req, res) => res.sendFile(path.join(__dirname, 'public', 'terms.html')));
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'public', 'privacy.html')));

const rooms = {};
const DISCONNECT_GRACE = 2 * 60 * 1000;

const PLAYER_COLORS = [
  '#0078d4', '#00c896', '#ffc246', '#ff6b9d',
  '#b88fff', '#ff8c42', '#00d4ff', '#ff3a5c',
];

function generateRoomId() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function sanitizeRoom(room) {
  return {
    id: room.id,
    hostId: room.hostId,
    topic: room.topic,
    phase: room.phase,
    round: room.round || 1,
    settings: room.settings || { numberRange: 'all', maxPlayers: 8 },
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      color: p.color || '#0078d4',
      isSpectator: p.isSpectator || false,
      disconnected: p.disconnected || false,
      hasCard: p.card !== null,
    })),
  };
}

function activePlayers(room) {
  return room.players.filter(p => !p.isSpectator);
}

function assignCards(players, settings) {
  const used = new Set();
  let min = 1, max = 100;
  if (settings) {
    if (settings.numberRange === 'low')  max = 50;
    if (settings.numberRange === 'high') min = 51;
  }
  players.forEach(p => {
    let card;
    do { card = Math.floor(Math.random() * (max - min + 1)) + min; } while (used.has(card));
    used.add(card);
    p.card = card;
  });
}

function getNextColor(room) {
  const used = new Set(room.players.map(p => p.color));
  return PLAYER_COLORS.find(c => !used.has(c)) || PLAYER_COLORS[room.players.length % PLAYER_COLORS.length];
}

io.on('connection', (socket) => {

  socket.on('createRoom', ({ playerName, clientId }) => {
    const name = playerName.trim().slice(0, 16);
    if (!name) return socket.emit('error', '名前を入力してください');

    const roomId = generateRoomId();
    const color = PLAYER_COLORS[0];
    rooms[roomId] = {
      id: roomId,
      hostId: socket.id,
      players: [{ id: socket.id, clientId, name, color, card: null, isSpectator: false }],
      topic: '',
      phase: 'lobby',
      cardOrder: [],
      round: 1,
      settings: { numberRange: 'all', maxPlayers: 8 },
      timer: null,
    };
    socket.join(roomId);
    socket.roomId = roomId;
    socket.emit('roomJoined', { roomId, isHost: true, isSpectator: false, color });
    io.to(roomId).emit('roomUpdated', sanitizeRoom(rooms[roomId]));
  });

  socket.on('joinRoom', ({ playerName, roomId, isSpectator, clientId }) => {
    const name = playerName.trim().slice(0, 16);
    if (!name) return socket.emit('error', '名前を入力してください');
    const room = rooms[roomId];
    if (!room) return socket.emit('error', 'ルームが見つかりません');
    if (room.phase === 'reveal') return socket.emit('error', 'めくり中は参加できません');

    const existing = clientId ? room.players.find(p => p.clientId === clientId && p.disconnected) : null;

    if (existing) {
      if (existing.disconnectTimer) clearTimeout(existing.disconnectTimer);
      const oldId = existing.id;
      existing.id = socket.id;
      existing.disconnected = false;
      existing.disconnectTimer = null;
      room.cardOrder = room.cardOrder.map(id => id === oldId ? socket.id : id);
      if (room.hostId === oldId) room.hostId = socket.id;

      socket.join(roomId);
      socket.roomId = roomId;
      const isHost = room.hostId === socket.id;
      socket.emit('roomJoined', { roomId, isHost, isSpectator: existing.isSpectator, restored: true, color: existing.color });

      if (existing.card) socket.emit('yourCard', { card: existing.card });

      if (room.phase === 'game') {
        socket.emit('gameStarted', {
          room: sanitizeRoom(room),
          topic: room.topic,
          cardOrder: room.cardOrder,
          round: room.round,
        });
        if (existing.isSpectator) {
          const allCards = activePlayers(room).filter(p => p.card).map(p => ({ id: p.id, name: p.name, card: p.card, color: p.color }));
          socket.emit('spectatorCards', allCards);
        }
        if (room.timer) {
          const elapsed = (Date.now() - room.timer.startedAt) / 1000;
          const remaining = Math.max(0, room.timer.seconds - elapsed);
          if (remaining > 0) socket.emit('timerStart', { seconds: Math.ceil(remaining) });
        }
      }

      io.to(roomId).emit('roomUpdated', sanitizeRoom(room));
      return;
    }

    const maxP = (room.settings && room.settings.maxPlayers) || 8;
    if (!isSpectator && activePlayers(room).length >= maxP) return socket.emit('error', 'ルームが満員です');

    const color = getNextColor(room);
    const newPlayer = { id: socket.id, clientId, name, color, card: null, isSpectator: !!isSpectator };
    room.players.push(newPlayer);
    socket.join(roomId);
    socket.roomId = roomId;
    socket.emit('roomJoined', { roomId, isHost: false, isSpectator: !!isSpectator, color });

    if (!isSpectator && room.phase === 'game') {
      const used = new Set(activePlayers(room).filter(p => p.card).map(p => p.card));
      let min = 1, max = 100;
      if (room.settings) {
        if (room.settings.numberRange === 'low') max = 50;
        if (room.settings.numberRange === 'high') min = 51;
      }
      let card;
      do { card = Math.floor(Math.random() * (max - min + 1)) + min; } while (used.has(card));
      newPlayer.card = card;
      room.cardOrder.push(socket.id);
      socket.emit('yourCard', { card });
      socket.emit('gameStarted', {
        room: sanitizeRoom(room),
        topic: room.topic,
        cardOrder: room.cardOrder,
        round: room.round,
      });
      io.to(roomId).emit('roomUpdated', sanitizeRoom(room));
      io.to(roomId).emit('orderUpdated', room.cardOrder);
    } else if (isSpectator && room.phase === 'game') {
      socket.emit('gameStarted', {
        room: sanitizeRoom(room),
        topic: room.topic,
        cardOrder: room.cardOrder,
        round: room.round,
      });
      const allCards = activePlayers(room).map(p => ({ id: p.id, name: p.name, card: p.card, color: p.color }));
      socket.emit('spectatorCards', allCards);
    } else if (isSpectator && room.phase === 'reveal') {
      socket.emit('revealStarted', {
        orderedCards: room.orderedCards.map(p => ({ id: p.id, name: p.name, color: p.color })),
        round: room.round,
      });
      for (let i = 0; i <= room.revealIndex; i++) {
        const card = room.orderedCards[i];
        const isLast = i === room.orderedCards.length - 1;
        socket.emit('cardRevealed', { index: i, card, isLast });
      }
    }

    io.to(roomId).emit('roomUpdated', sanitizeRoom(room));
  });

  socket.on('setTopic', ({ topic }) => {
    const room = rooms[socket.roomId];
    if (!room || room.hostId !== socket.id) return;
    room.topic = topic.trim().slice(0, 40);
    io.to(socket.roomId).emit('roomUpdated', sanitizeRoom(room));
  });

  socket.on('suggestTopic', ({ topic }) => {
    const room = rooms[socket.roomId];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    const t = topic.trim().slice(0, 40);
    if (!t) return;
    io.to(room.hostId).emit('topicSuggested', { name: player.name, topic: t, color: player.color });
  });

  socket.on('setRoomSettings', ({ settings }) => {
    const room = rooms[socket.roomId];
    if (!room || room.hostId !== socket.id) return;
    room.settings = { ...room.settings, ...settings };
    io.to(socket.roomId).emit('roomUpdated', sanitizeRoom(room));
  });

  socket.on('startGame', () => {
    const room = rooms[socket.roomId];
    if (!room || room.hostId !== socket.id) return;
    const active = activePlayers(room).filter(p => !p.disconnected);
    if (active.length < 2) return socket.emit('error', '2人以上必要です');
    if (!room.topic) return socket.emit('error', 'お題を設定してください');

    assignCards(active, room.settings);
    room.phase = 'game';
    room.cardOrder = active.map(p => p.id);
    room.timer = null;

    io.to(socket.roomId).emit('gameStarted', {
      room: sanitizeRoom(room),
      topic: room.topic,
      cardOrder: room.cardOrder,
      round: room.round,
    });
    active.forEach(p => {
      io.to(p.id).emit('yourCard', { card: p.card });
    });
    const allCards = active.map(p => ({ id: p.id, name: p.name, card: p.card, color: p.color }));
    room.players.filter(p => p.isSpectator && !p.disconnected).forEach(p => {
      io.to(p.id).emit('spectatorCards', allCards);
    });
  });

  socket.on('updateOrder', ({ cardOrder }) => {
    const room = rooms[socket.roomId];
    if (!room || room.phase !== 'game') return;
    if (!Array.isArray(cardOrder)) return;
    const validIds = new Set(activePlayers(room).map(p => p.id));
    if (!cardOrder.every(id => validIds.has(id))) return;
    room.cardOrder = cardOrder;
    socket.to(socket.roomId).emit('orderUpdated', cardOrder);
  });

  socket.on('startReveal', () => {
    const room = rooms[socket.roomId];
    if (!room || room.hostId !== socket.id || room.phase !== 'game') return;
    room.phase = 'reveal';
    room.revealIndex = -1;
    room.timer = null;
    io.to(socket.roomId).emit('timerStop');
    const orderedCards = room.cardOrder.map(id => {
      const p = room.players.find(x => x.id === id);
      return { id: p.id, name: p.name, card: p.card, color: p.color };
    });
    room.orderedCards = orderedCards;
    io.to(socket.roomId).emit('revealStarted', {
      orderedCards: orderedCards.map(p => ({ id: p.id, name: p.name, color: p.color })),
      round: room.round,
    });
  });

  socket.on('revealNext', () => {
    const room = rooms[socket.roomId];
    if (!room || room.hostId !== socket.id || room.phase !== 'reveal') return;
    room.revealIndex++;
    if (room.revealIndex >= room.orderedCards.length) return;
    const card = room.orderedCards[room.revealIndex];
    const isLast = room.revealIndex === room.orderedCards.length - 1;
    io.to(socket.roomId).emit('cardRevealed', { index: room.revealIndex, card, isLast });
  });

  socket.on('reaction', ({ emoji }) => {
    const room = rooms[socket.roomId];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    const validEmojis = ['👍', '😂', '😱', '🔥', '💀'];
    if (!validEmojis.includes(emoji)) return;
    io.to(socket.roomId).emit('reaction', { emoji, senderName: player.name, color: player.color });
  });

  socket.on('chat', ({ msg }) => {
    const room = rooms[socket.roomId];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    const sanitized = String(msg).trim().slice(0, 100);
    if (!sanitized) return;
    io.to(socket.roomId).emit('chat', {
      senderId: socket.id,
      name: player.name,
      color: player.color,
      msg: sanitized,
    });
  });

  socket.on('kickPlayer', ({ playerId }) => {
    const room = rooms[socket.roomId];
    if (!room || room.hostId !== socket.id) return;
    if (playerId === socket.id) return;
    const target = room.players.find(p => p.id === playerId);
    if (!target) return;
    io.to(playerId).emit('kicked');
    if (target.disconnectTimer) clearTimeout(target.disconnectTimer);
    room.players = room.players.filter(p => p.id !== playerId);
    room.cardOrder = room.cardOrder.filter(id => id !== playerId);
    io.to(socket.roomId).emit('roomUpdated', sanitizeRoom(room));
  });

  socket.on('timerStart', ({ seconds }) => {
    const room = rooms[socket.roomId];
    if (!room || room.hostId !== socket.id) return;
    const s = Math.min(Math.max(parseInt(seconds) || 60, 10), 300);
    room.timer = { seconds: s, startedAt: Date.now() };
    io.to(socket.roomId).emit('timerStart', { seconds: s });
  });

  socket.on('timerStop', () => {
    const room = rooms[socket.roomId];
    if (!room || room.hostId !== socket.id) return;
    room.timer = null;
    io.to(socket.roomId).emit('timerStop');
  });

  socket.on('backToLobby', () => {
    const room = rooms[socket.roomId];
    if (!room || room.hostId !== socket.id) return;
    room.phase = 'lobby';
    room.round = (room.round || 1) + 1;
    room.players.forEach(p => p.card = null);
    room.cardOrder = [];
    room.topic = '';
    room.timer = null;
    io.to(socket.roomId).emit('timerStop');
    io.to(socket.roomId).emit('roomUpdated', sanitizeRoom(room));
  });

  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    const player = room.players.find(p => p.id === socket.id);

    if (player) {
      player.disconnected = true;
      player.disconnectTimer = setTimeout(() => {
        room.players = room.players.filter(p => p.id !== socket.id);
        room.cardOrder = room.cardOrder.filter(id => id !== socket.id);
        if (room.players.filter(p => !p.disconnected).length === 0) {
          delete rooms[roomId];
          return;
        }
        if (room.hostId === socket.id) {
          const next = room.players.find(p => !p.disconnected && !p.isSpectator)
            || room.players.find(p => !p.disconnected);
          if (next) {
            room.hostId = next.id;
            io.to(next.id).emit('youAreHost');
          }
        }
        io.to(roomId).emit('roomUpdated', sanitizeRoom(room));
      }, DISCONNECT_GRACE);

      if (room.hostId === socket.id) {
        const next = room.players.find(p => !p.disconnected && !p.isSpectator && p.id !== socket.id)
          || room.players.find(p => !p.disconnected && p.id !== socket.id);
        if (next) {
          room.hostId = next.id;
          io.to(next.id).emit('youAreHost');
        }
      }
    }

    io.to(roomId).emit('roomUpdated', sanitizeRoom(room));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Ito game server running at http://localhost:${PORT}`);
});
