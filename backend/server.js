const express = require('express');
const http = require('http');
const socketio = require('socket.io');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const authRoutes = require('./routes/auth');
const verifierToken = require('./middleware/auth');
const User = require('./models/User');
const Message = require('./models/Message');

const app = express();
app.use(express.static('../frontend'));
app.use(express.json());

app.use('/api/auth', authRoutes);

app.get('/api/users', verifierToken, async (req, res) => {
  try {
    const users = await User.find({ _id: { $ne: req.user.id } })
      .select('-password')
      .sort({ lastSeen: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/messages/:userId', verifierToken, async (req, res) => {
  try {
    const myId = req.user.id;
    const otherId = req.params.userId;
    const messages = await Message.find({
      $or: [
        { sender: myId, receiver: otherId },
        { sender: otherId, receiver: myId }
      ]
    }).sort({ timestamp: 1 });

    await Message.updateMany(
      { sender: otherId, receiver: myId, readAt: null },
      { readAt: new Date() }
    );

    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const server = http.createServer(app);
const io = socketio(server);

const onlineUsers = new Map();
const disconnectTimers = new Map();

io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token) return next(new Error('Token manquant'));
  jwt.verify(token, 'secret_key', (err, decoded) => {
    if (err) return next(new Error('Token invalide'));
    socket.userId = decoded.id;
    socket.username = decoded.username;
    next();
  });
});

async function setStatus(userId, status) {
  await User.findByIdAndUpdate(userId, { status, lastSeen: new Date() });
  io.emit('userStatusUpdate', { userId, status, lastSeen: new Date() });
}

io.on('connection', (socket) => {
  const userId = socket.userId;
  onlineUsers.set(userId, socket.id);

  if (disconnectTimers.has(userId)) {
    clearTimeout(disconnectTimers.get(userId));
    disconnectTimers.delete(userId);
  }

  setStatus(userId, 'actif');

  socket.on('heartbeat', async () => {
    await User.findByIdAndUpdate(userId, { lastSeen: new Date() });
  });

  socket.on('sendMessage', async (data) => {
    try {
      const newMessage = new Message({
        sender: userId,
        receiver: data.receiverId,
        message: data.message,
        timestamp: new Date()
      });
      await newMessage.save();

      const receiverSocketId = onlineUsers.get(data.receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('receiveMessage', newMessage);
      }
      socket.emit('receiveMessage', newMessage);
    } catch (err) {
      console.log(err);
    }
  });

  socket.on('typing', (data) => {
    const receiverSocketId = onlineUsers.get(data.receiverId);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('typing', { senderId: userId });
    }
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(userId);
    const timer = setTimeout(() => {
      setStatus(userId, 'inactif');
      disconnectTimers.delete(userId);
    }, 10000);
    disconnectTimers.set(userId, timer);
  });
});

const mongoUri = process.env.MONGODB_URI;

mongoose.connect(mongoUri)
  .then(() => {
    console.log('MongoDB connecte');

    server.listen(process.env.PORT || 3000, () => {
      console.log('Serveur demarre');
    });
  })
  .catch((err) => {
    console.error('Erreur de connexion MongoDB :', err);
    process.exit(1);
  });
