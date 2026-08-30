const express = require('express');
const http = require('http');
const socketio = require('socket.io');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const webpush = require('web-push');

const authRoutes = require('./routes/auth');
const verifierToken = require('./middleware/auth');
const User = require('./models/User');
const Message = require('./models/Message');

const app = express();

app.use(express.static('../frontend'));
app.use(express.json());

app.use('/api/auth', authRoutes);

/* =========================================================
WEB PUSH / VAPID
========================================================= */

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_EMAIL = process.env.VAPID_EMAIL || 'mailto:cakpopascal29@gmail.com';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
webpush.setVapidDetails(
VAPID_EMAIL,
VAPID_PUBLIC_KEY,
VAPID_PRIVATE_KEY
);

console.log('Web Push active');
} else {
console.log('Web Push non configure : cles VAPID manquantes');
}

/* =========================================================
CLE PUBLIQUE VAPID
========================================================= */

app.get('/api/notifications/vapid-public-key', verifierToken, (req, res) => {
if (!VAPID_PUBLIC_KEY) {
return res.status(503).json({
error: 'Notifications non configurees sur le serveur'
});
}

res.json({
publicKey: VAPID_PUBLIC_KEY
});
});

/* =========================================================
ENREGISTRER UN APPAREIL POUR LES NOTIFICATIONS
========================================================= */

app.post('/api/notifications/subscribe', verifierToken, async (req, res) => {
try {
const subscription = req.body;

if (
  !subscription ||
  !subscription.endpoint ||
  !subscription.keys ||
  !subscription.keys.p256dh ||
  !subscription.keys.auth
) {
  return res.status(400).json({
    error: 'Souscription Push invalide'
  });
}

const user = await User.findById(req.user.id);

if (!user) {
  return res.status(404).json({
    error: 'Utilisateur introuvable'
  });
}

const existe = user.pushSubscriptions.some(
  sub => sub.endpoint === subscription.endpoint
);

if (!existe) {
  user.pushSubscriptions.push({
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime || null,
    keys: {
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth
    }
  });

  await user.save();
}

res.json({
  message: 'Notifications activees'
});

} catch (err) {
console.error('Erreur subscribe:', err);
res.status(500).json({
error: err.message
});
}
});

/* =========================================================
SUPPRIMER UN APPAREIL DES NOTIFICATIONS
========================================================= */

app.delete('/api/notifications/subscribe', verifierToken, async (req, res) => {
try {
const { endpoint } = req.body;

if (!endpoint) {
  return res.status(400).json({
    error: 'Endpoint manquant'
  });
}

await User.updateOne(
  { _id: req.user.id },
  {
    $pull: {
      pushSubscriptions: {
        endpoint: endpoint
      }
    }
  }
);

res.json({
  message: 'Souscription supprimee'
});

} catch (err) {
res.status(500).json({
error: err.message
});
}
});

/* =========================================================
UTILISATEURS
========================================================= */

app.get('/api/users', verifierToken, async (req, res) => {
try {
const users = await User.find({
_id: { $ne: req.user.id }
})
.select('-password -pushSubscriptions')
.sort({ lastSeen: -1 });

res.json(users);

} catch (err) {
res.status(500).json({
error: err.message
});
}
});

/* =========================================================
COMPTEURS DE MESSAGES NON LUS
========================================================= */

app.get('/api/messages/unread-counts', verifierToken, async (req, res) => {
try {
const results = await Message.aggregate([
{
$match: {
receiver: new mongoose.Types.ObjectId(req.user.id),
readAt: null
}
},
{
$group: {
_id: '$sender',
count: { $sum: 1 }
}
}
]);

const counts = {};

results.forEach(item => {
  counts[item._id.toString()] = item.count;
});

res.json(counts);

} catch (err) {
res.status(500).json({
error: err.message
});
}
});

/* =========================================================
MESSAGES D'UNE CONVERSATION
========================================================= */

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
  {
    sender: otherId,
    receiver: myId,
    readAt: null
  },
  {
    readAt: new Date()
  }
);

res.json(messages);

} catch (err) {
res.status(500).json({
error: err.message
});
}
});

/* =========================================================
MARQUER UNE CONVERSATION COMME LUE
========================================================= */

app.post('/api/messages/:userId/read', verifierToken, async (req, res) => {
try {
await Message.updateMany(
{
sender: req.params.userId,
receiver: req.user.id,
readAt: null
},
{
readAt: new Date()
}
);

res.json({
  message: 'Messages marques comme lus'
});

} catch (err) {
res.status(500).json({
error: err.message
});
}
});

/* =========================================================
SUPPRESSION UTILISATEUR
========================================================= */

app.delete('/api/users/:id', verifierToken, async (req, res) => {
try {
if (req.user.username !== "HIRO'od") {
return res.status(403).json({
error: 'Action reservee a l administrateur'
});
}

const userId = req.params.id;

await Message.deleteMany({
  $or: [
    { sender: userId },
    { receiver: userId }
  ]
});

await User.findByIdAndDelete(userId);

res.json({
  message: 'Utilisateur supprime'
});

} catch (err) {
res.status(500).json({
error: err.message
});
}
});

/* =========================================================
SOCKET.IO
========================================================= */

const server = http.createServer(app);
const io = socketio(server);

const onlineUsers = new Map();
const disconnectTimers = new Map();

io.use((socket, next) => {
const token = socket.handshake.auth && socket.handshake.auth.token;

if (!token) {
return next(new Error('Token manquant'));
}

jwt.verify(token, 'secret_key', (err, decoded) => {
if (err) {
return next(new Error('Token invalide'));
}

socket.userId = decoded.id;
socket.username = decoded.username;

next();

});
});

/* =========================================================
STATUT
========================================================= */

async function setStatus(userId, status) {
await User.findByIdAndUpdate(
userId,
{
status,
lastSeen: new Date()
}
);

io.emit('userStatusUpdate', {
userId,
status,
lastSeen: new Date()
});
}

/* =========================================================
ENVOYER UNE NOTIFICATION PUSH
========================================================= */

async function envoyerNotificationPush(receiverId, senderUsername, message) {
if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
return;
}

try {
const receiver = await User.findById(receiverId);

if (!receiver || !receiver.pushSubscriptions.length) {
  return;
}

const payload = JSON.stringify({
  title: senderUsername,
  body: message,
  icon: '/icon-192.png',
  badge: '/icon-192.png',
  url: '/chat.html',
  senderId: receiverId
});

const subscriptionsRestantes = [];

for (const subscription of receiver.pushSubscriptions) {
  try {
    await webpush.sendNotification(
      subscription.toObject(),
      payload
    );

    subscriptionsRestantes.push(subscription);

  } catch (err) {

    if (err.statusCode !== 404 && err.statusCode !== 410) {
      console.error(
        'Erreur notification Push:',
        err.message
      );

      subscriptionsRestantes.push(subscription);
    }
  }
}

receiver.pushSubscriptions = subscriptionsRestantes;
await receiver.save();

} catch (err) {
console.error(
'Erreur generale notification Push:',
err.message
);
}
}

/* =========================================================
CONNECTION SOCKET
========================================================= */

io.on('connection', (socket) => {

const userId = socket.userId;

onlineUsers.set(userId, socket.id);

if (disconnectTimers.has(userId)) {
clearTimeout(disconnectTimers.get(userId));
disconnectTimers.delete(userId);
}

setStatus(userId, 'actif');

/* HEARTBEAT */

socket.on('heartbeat', async () => {
await User.findByIdAndUpdate(
userId,
{
lastSeen: new Date()
}
);
});
/* =========================================================
   CONNECTION SOCKET
========================================================= */

io.on('connection', (socket) => {

  const userId = String(socket.userId);

  onlineUsers.set(
    userId,
    socket.id
  );

  console.log(
    'Utilisateur connecté en temps réel :',
    userId
  );


  if (disconnectTimers.has(userId)) {

    clearTimeout(
      disconnectTimers.get(userId)
    );

    disconnectTimers.delete(
      userId
    );

  }


  setStatus(
    userId,
    'actif'
  );


  /* =======================================================
     HEARTBEAT
  ======================================================= */

  socket.on(
    'heartbeat',
    async () => {

      await User.findByIdAndUpdate(
        userId,
        {
          lastSeen:
            new Date()
        }
      );

    }
  );


  /* =======================================================
     ENVOYER MESSAGE
  ======================================================= */

  socket.on(
    'sendMessage',
    async (data) => {

      try {

        if (
          !data ||
          !data.receiverId ||
          !data.message
        ) {

          return;

        }


        const receiverId =
          String(
            data.receiverId
          );


        const newMessage =
          new Message({

            sender:
              userId,

            receiver:
              receiverId,

            message:
              data.message.trim(),

            timestamp:
              new Date()

          });


        await newMessage.save();


        /* ===============================================
           ENVOI IMMÉDIAT AU DESTINATAIRE
        =============================================== */

        const receiverSocketId =
          onlineUsers.get(
            receiverId
          );


        if (receiverSocketId) {

          io.to(
            receiverSocketId
          ).emit(
            'receiveMessage',
            newMessage
          );

        }


        /* ===============================================
           CONFIRMATION IMMÉDIATE CHEZ L'EXPÉDITEUR
        =============================================== */

        socket.emit(
          'receiveMessage',
          newMessage
        );


        /* ===============================================
           NOTIFICATION PUSH EN ARRIÈRE-PLAN
        =============================================== */

        envoyerNotificationPush(
          receiverId,
          socket.username,
          data.message
        ).catch(
          err => {

            console.error(
              'Erreur notification Push:',
              err.message
            );

          }
        );


      } catch (err) {

        console.error(
          'Erreur sendMessage:',
          err
        );

      }

    }
  );


  /* =======================================================
     TYPING
  ======================================================= */

  socket.on(
    'typing',
    (data) => {

      if (
        !data ||
        !data.receiverId
      ) {

        return;

      }


      const receiverSocketId =
        onlineUsers.get(
          String(
            data.receiverId
          )
        );


      if (receiverSocketId) {

        io.to(
          receiverSocketId
        ).emit(
          'typing',
          {
            senderId:
              userId
          }
        );

      }

    }
  );

/* =======================================================
DECONNEXION
======================================================= */

socket.on('disconnect', () => {

onlineUsers.delete(userId);

const timer = setTimeout(() => {

  setStatus(
    userId,
    'inactif'
  );

  disconnectTimers.delete(userId);

}, 10000);

disconnectTimers.set(
  userId,
  timer
);

});
});

/* =========================================================
MONGODB
========================================================= */

const mongoUri = process.env.MONGODB_URI;

mongoose.connect(mongoUri);

/* =========================================================
SERVEUR
========================================================= */

server.listen(
process.env.PORT || 3000,
() => {
console.log('Serveur demarre');
}
);
