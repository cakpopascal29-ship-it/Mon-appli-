const express = require('express');
const http = require('http');
const socketio = require('socket.io');
const mongoose = require('mongoose');

const authRoutes = require('./routes/auth');
const Message = require('./models/Message');

const app = express();
app.use(express.static('../frontend'));
app.use(express.json());

app.use('/api/auth', authRoutes);

app.get('/api/messages', async (req, res) => {
  try {
    const messages = await Message.find().sort({ timestamp: 1 }).limit(50);
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const server = http.createServer(app);
const io = socketio(server);

io.on('connection', (socket) => {
  console.log('Nouvel utilisateur connecte');

  socket.on('sendMessage', async (data) => {
    try {
      const newMessage = new Message({
        sender: data.sender,
        message: data.message,
        timestamp: new Date()
      });
      await newMessage.save();
      io.emit('receiveMessage', newMessage);
    } catch (err) {
      console.log(err);
    }
  });

  socket.on('disconnect', () => {
    console.log('Utilisateur deconnecte');
  });
});

mongoose.connect('mongodb+srv://cakpopascal29_db_user:PascalProjet@cluster0.yxg16mf.mongodb.net/chatapp?appName=Cluster0');

server.listen(process.env.PORT || 3000, () => {
  console.log('Serveur demarre');
});
