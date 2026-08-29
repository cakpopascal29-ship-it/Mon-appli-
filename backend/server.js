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
    if (err) return next(new Error('Token inv
