const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};
const DISCONNECT_GRACE = 2 * 60 * 1000; // 2分

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
      disconnected: p.disconnected || false,
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

  socket.on('createRoom', ({ playerName, clientId }) => {
    const name = playerName.trim().slice(0, 16);
    if (!name) return socket.emit('error', '名前を入力してください');

    const roomId = generateRoomId();
    rooms[roomId] = {
      id: roomId,
      hostId: socket.id,
      players: [{ id: socket.id, clientId, name, card: null, isSpectator: false }],
      topic: '',
      phase: 'lobby',
      cardOrder: [],
    };
    socket.join(roomId);
    socket.roomId = roomId;
    socket.emit('roomJoined', { roomId, isHost: true, isSpectator: false });
    io.to(roomId).emit('roomUpdated', sanitizeRoom(rooms[roomId]));
  });

  socket.on('joinRoom', ({ playerName, roomId, isSpectator, clientId }) => {
    const name = playerName.trim().slice(0, 16);
    if (!name) return socket.emit('error', '名前を入力してください');
    const room = rooms[roomId];
    if (!room) return socket.emit('error', 'ルームが見つかりません');
    if (room.phase === 'reveal') return socket.emit('error', 'めくり中は参加できません');

    // 同じclientIdの切断済みプレイヤーを探す
    const existing = clientId ? room.players.find(p => p.clientId === clientId && p.disconnected) : null;

    if (existing) {
      // セッション復元
      if (existing.disconnectTimer) clearTimeout(existing.disconnectTimer);
      const oldId = existing.id;
      existing.id = socket.id;
      existing.disconnected = false;
      existing.disconnectTimer = null;
      // cardOrderとhostIdの古いIDを新しいsocket.idに更新
      room.cardOrder = room.cardOrder.map(id => id === oldId ? socket.id : id);
      if (room.hostId === oldId) room.hostId = socket.id;

      socket.join(roomId);
      socket.roomId = roomId;
      const isHost = room.hostId === socket.id;
      socket.emit('roomJoined', { roomId, isHost, isSpectator: existing.isSpectator, restored: true });

      if (existing.card) socket.emit('yourCard', { card: existing.card });

      if (room.phase === 'game') {
        socket.emit('gameStarted', {
          room: sanitizeRoom(room),
          topic: room.topic,
          cardOrder: room.cardOrder,
        });
        if (existing.isSpectator) {
          const allCards = activePlayers(room).filter(p => p.card).map(p => ({ id: p.id, name: p.name, card: p.card }));
          socket.emit('spectatorCards', allCards);
        }
      }

      io.to(roomId).emit('roomUpdated', sanitizeRoom(room));
      return;
    }

    if (!isSpectator && activePlayers(room).length >= 8) return socket.emit('error', 'ルームが満員です');

    const newPlayer = { id: socket.id, clientId, name, card: null, isSpectator: !!isSpectator };
    room.players.push(newPlayer);
    socket.join(roomId);
    socket.roomId = roomId;
    socket.emit('roomJoined', { roomId, isHost: false, isSpectator: !!isSpectator });

    if (!isSpectator && room.phase === 'game') {
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
      // roomUpdatedを先に送ってからorderUpdated（プレイヤーリスト先に届かせる）
      io.to(roomId).emit('roomUpdated', sanitizeRoom(room));
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
    const active = activePlayers(room).filter(p => !p.disconnected);
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
    const allCards = active.map(p => ({ id: p.id, name: p.name, card: p.card }));
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
    const player = room.players.find(p => p.id === socket.id);

    if (player) {
      player.disconnected = true;
      // 2分後に削除
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

      // ホストが切断した場合は即座に別の人をホストに
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
