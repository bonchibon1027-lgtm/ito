const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

function generateRoomId() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function sanitizeRoom(room, requesterId) {
  return {
    ...room,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      hasCard: p.card !== null,
    })),
  };
}

function assignCards(players) {
  const used = new Set();
  players.forEach(p => {
    let card;
    do { card = Math.floor(Math.random() * 100) + 1; } while (used.has(card));
    used.add(card);
    p.card = card;
  });
}

io.on('connection', (socket) => {

  socket.on('createRoom', ({ playerName }) => {
    const name = playerName.trim().slice(0, 16);
    if (!name) return socket.emit('error', '名前を入力してください');

    const roomId = generateRoomId();
    rooms[roomId] = {
      id: roomId,
      hostId: socket.id,
      players: [{ id: socket.id, name, card: null }],
      topic: '',
      phase: 'lobby',
      cardOrder: [],
    };
    socket.join(roomId);
    socket.roomId = roomId;
    socket.emit('roomJoined', { roomId, isHost: true });
    io.to(roomId).emit('roomUpdated', sanitizeRoom(rooms[roomId]));
  });

  socket.on('joinRoom', ({ playerName, roomId }) => {
    const name = playerName.trim().slice(0, 16);
    if (!name) return socket.emit('error', '名前を入力してください');
    const room = rooms[roomId];
    if (!room) return socket.emit('error', 'ルームが見つかりません');
    if (room.phase !== 'lobby') return socket.emit('error', 'ゲームはすでに開始されています');
    if (room.players.length >= 8) return socket.emit('error', 'ルームが満員です');

    room.players.push({ id: socket.id, name, card: null });
    socket.join(roomId);
    socket.roomId = roomId;
    socket.emit('roomJoined', { roomId, isHost: false });
    io.to(roomId).emit('roomUpdated', sanitizeRoom(room));
  });

  socket.on('setTopic', ({ topic }) => {
    const room = rooms[socket.roomId];
    if (!room || room.hostId !== socket.id) return;
    room.topic = topic.trim().slice(0, 40);
    io.to(socket.roomId).emit('roomUpdated', sanitizeRoom(room));
  });

  socket.on('startGame', () => {
    const room = rooms[socket.roomId];
    if (!room || room.hostId !== socket.id) return;
    if (room.players.length < 2) return socket.emit('error', '2人以上必要です');
    if (!room.topic) return socket.emit('error', 'お題を設定してください');

    assignCards(room.players);
    room.phase = 'game';
    room.cardOrder = room.players.map(p => p.id);

    io.to(socket.roomId).emit('gameStarted', {
      room: sanitizeRoom(room),
      topic: room.topic,
      cardOrder: room.cardOrder,
    });
    room.players.forEach(p => {
      io.to(p.id).emit('yourCard', { card: p.card });
    });
  });

  socket.on('updateOrder', ({ cardOrder }) => {
    const room = rooms[socket.roomId];
    if (!room || room.phase !== 'game') return;
    if (!Array.isArray(cardOrder)) return;
    // validate all ids belong to the room
    const validIds = new Set(room.players.map(p => p.id));
    if (!cardOrder.every(id => validIds.has(id))) return;
    room.cardOrder = cardOrder;
    socket.to(socket.roomId).emit('orderUpdated', cardOrder);
  });

  socket.on('startReveal', () => {
    const room = rooms[socket.roomId];
    if (!room || room.hostId !== socket.id || room.phase !== 'game') return;
    room.phase = 'reveal';
    room.revealIndex = -1;
    const orderedCards = room.cardOrder.map(id => {
      const p = room.players.find(x => x.id === id);
      return { id: p.id, name: p.name, card: p.card };
    });
    room.orderedCards = orderedCards;
    io.to(socket.roomId).emit('revealStarted', { orderedCards: orderedCards.map(p => ({ id: p.id, name: p.name })) });
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

  socket.on('backToLobby', () => {
    const room = rooms[socket.roomId];
    if (!room || room.hostId !== socket.id) return;
    room.phase = 'lobby';
    room.players.forEach(p => p.card = null);
    room.cardOrder = [];
    room.topic = '';
    io.to(socket.roomId).emit('roomUpdated', sanitizeRoom(room));
  });

  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    room.players = room.players.filter(p => p.id !== socket.id);
    room.cardOrder = room.cardOrder.filter(id => id !== socket.id);
    if (room.players.length === 0) {
      delete rooms[roomId];
      return;
    }
    if (room.hostId === socket.id) {
      room.hostId = room.players[0].id;
      io.to(room.players[0].id).emit('youAreHost');
    }
    io.to(roomId).emit('roomUpdated', sanitizeRoom(room));
    if (room.phase === 'game') {
      io.to(roomId).emit('orderUpdated', room.cardOrder);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Ito game server running at http://localhost:${PORT}`);
});
