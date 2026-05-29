const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { nanoid } = require('nanoid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// Хранилище комнат: { roomId: { markers: Map, lines: Map } }
const rooms = new Map();

io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('join-room', ({ roomId }) => {
    if (currentRoom) socket.leave(currentRoom);
    socket.join(roomId);
    currentRoom = roomId;

    if (!rooms.has(roomId)) {
      rooms.set(roomId, { markers: new Map(), lines: new Map() });
    }
    const roomData = rooms.get(roomId);

    socket.emit('room-state', {
      markers: Array.from(roomData.markers.entries()).map(([id, m]) => ({ id, ...m })),
      lines: Array.from(roomData.lines.entries()).map(([id, l]) => ({ id, ...l }))
    });
  });

  socket.on('add-marker', ({ roomId, marker }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const id = nanoid();
    room.markers.set(id, { ...marker, id });
    io.to(roomId).emit('marker-added', { id, ...marker });
  });

  socket.on('remove-marker', ({ roomId, markerId }) => {
    const room = rooms.get(roomId);
    if (room && room.markers.delete(markerId)) {
      io.to(roomId).emit('marker-removed', { markerId });
    }
  });

  socket.on('add-line', ({ roomId, line }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const id = nanoid();
    room.lines.set(id, { ...line, id });
    io.to(roomId).emit('line-added', { id, ...line });
  });

  socket.on('remove-line', ({ roomId, lineId }) => {
    const room = rooms.get(roomId);
    if (room && room.lines.delete(lineId)) {
      io.to(roomId).emit('line-removed', { lineId });
    }
  });

  socket.on('add-brush-stroke', ({ roomId, points, color, opacity, thickness }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const id = nanoid();
    const brushLine = {
        id,
        lineType: 'brush',
        points: points,
        color: color,
        opacity: opacity,
        thickness: thickness
    };
    room.lines.set(id, brushLine);
    io.to(roomId).emit('line-added', brushLine);
  });

  socket.on('disconnect', () => {});
});



// Страница комнаты
app.get('/room/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Создание новой комнаты
app.get('/create-room', (req, res) => {
  const roomId = nanoid(6);
  res.redirect(`/room/${roomId}`);
});

// Главная страница
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Сервер запущен на http://localhost:${PORT}`));