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

function sanitizeRoom(room) {
  return {
    ...room,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      isSpectator: p.isSpectator || false,
      hasCard: p.card !== null,
    })),
  };
}

function activePlayers(room) {
  return room.players.filter(p => !p.isSpectator);
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
      players: [{ id: socket.id, name, card: null, isSpectator: false }],
      topic: '',
      phase: 'lobby',
      cardOrder: [],
    };
    socket.join(roomId);
    socket.roomId = roomId;
    socket.emit('roomJoined', { roomId, isHost: true, isSpectator: false });
    io.to(roomId).emit('roomUpdated', sanitizeRoom(rooms[roomId]));
  });

  socket.on('joinRoom', ({ playerName, roomId, isSpectator }) => {
    const name = playerName.trim().slice(0, 16);
    if (!name) return socket.emit('error', '名前を入力してください');
    const room = rooms[roomId];
    if (!room) return socket.emit('error', 'ルームが見つかりません');
    if (room.phase === 'reveal') return socket.emit('error', 'めくり中は参加できません');
    if (!isSpectator && activePlayers(room).length >= 8) return socket.emit('error', 'ルームが満員です');

    const newPlayer = { id: socket.id, name, card: null, isSpectator: !!isSpectator };
    room.players.push(newPlayer);
    socket.join(roomId);
    socket.roomId = roomId;
    socket.emit('roomJoined', { roomId, isHost: false, isSpectator: !!isSpectator });

    if (!isSpectator && room.phase === 'game') {
      // ゲーム中途参加：カードを配って末尾に追加
      const used = new Set(activePlayers(room).filter(p => p.card).map(p => p.card));
      let card;
      do { card = Math.floor(Math.random() * 100) + 1; } while (used.has(card));
      newPlayer.card = card;
      room.cardOrder.push(socket.id);
      socket.emit('yourCard', { card });
      socket.emit('gameStarted', {
        room: sanitizeRoom(room),
        topic: room.topic,
        cardOrder: room.cardOrder,
      });
      io.to(roomId).emit('orderUpdated', room.cardOrder);
    } else if (isSpectator && room.phase === 'game') {
      socket.emit('gameStarted', {
        room: sanitizeRoom(room),
        topic: room.topic,
        cardOrder: room.cardOrder,
      });
      const allCards = activePlayers(room).map(p => ({ id: p.id, name: p.name, card: p.card }));
      socket.emit('spectatorCards', allCards);
    } else if (isSpectator && room.phase === 'reveal') {
      socket.emit('revealStarted', {
        orderedCards: room.orderedCards.map(p => ({ id: p.id, name: p.name })),
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

  socket.on('startGame', () => {
    const room = rooms[socket.roomId];
    if (!room || room.hostId !== socket.id) return;
    const active = activePlayers(room);
    if (active.length < 2) return socket.emit('error', '2人以上必要です');
    if (!room.topic) return socket.emit('error', 'お題を設定してください');

    assignCards(active);
    room.phase = 'game';
    room.cardOrder = active.map(p => p.id);

    io.to(socket.roomId).emit('gameStarted', {
      room: sanitizeRoom(room),
      topic: room.topic,
      cardOrder: room.cardOrder,
    });
    active.forEach(p => {
      io.to(p.id).emit('yourCard', { card: p.card });
    });
    // 観戦者には全カードを公開
    const allCards = active.map(p => ({ id: p.id, name: p.name, card: p.card }));
    room.players.filter(p => p.isSpectator).forEach(p => {
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
      const nextHost = activePlayers(room)[0] || room.players[0];
      room.hostId = nextHost.id;
      io.to(nextHost.id).emit('youAreHost');
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
