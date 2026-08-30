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

/* =========================================================
EXPRESS
========================================================= */

app.use(express.static('../frontend'));
app.use(express.json());

app.use('/api/auth', authRoutes);

/* =========================================================
WEB PUSH / VAPID
========================================================= */

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_EMAIL =
  process.env.VAPID_EMAIL ||
  'mailto:cakpopascal29@gmail.com';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {

  webpush.setVapidDetails(
    VAPID_EMAIL,
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );

  console.log('Web Push active');

} else {

  console.log(
    'Web Push non configure : cles VAPID manquantes'
  );

}

/* =========================================================
CLE PUBLIQUE VAPID
========================================================= */

app.get(
  '/api/notifications/vapid-public-key',
  verifierToken,
  (req, res) => {

    if (!VAPID_PUBLIC_KEY) {

      return res.status(503).json({
        error:
          'Notifications non configurees sur le serveur'
      });

    }

    res.json({
      publicKey: VAPID_PUBLIC_KEY
    });

  }
);

/* =========================================================
ENREGISTRER UN APPAREIL POUR LES NOTIFICATIONS
========================================================= */

app.post(
  '/api/notifications/subscribe',
  verifierToken,
  async (req, res) => {

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
          error:
            'Souscription Push invalide'
        });

      }

      const user =
        await User.findById(req.user.id);

      if (!user) {

        return res.status(404).json({
          error:
            'Utilisateur introuvable'
        });

      }

      if (!user.pushSubscriptions) {
        user.pushSubscriptions = [];
      }

      const existe =
        user.pushSubscriptions.some(
          sub =>
            sub.endpoint ===
            subscription.endpoint
        );

      if (!existe) {

        user.pushSubscriptions.push({
          endpoint:
            subscription.endpoint,

          expirationTime:
            subscription.expirationTime ||
            null,

          keys: {
            p256dh:
              subscription.keys.p256dh,

            auth:
              subscription.keys.auth
          }

        });

        await user.save();

      }

      res.json({
        message:
          'Notifications activees'
      });

    } catch (err) {

      console.error(
        'Erreur subscribe:',
        err
      );

      res.status(500).json({
        error:
          err.message
      });

    }

  }
);

/* =========================================================
SUPPRIMER UN APPAREIL DES NOTIFICATIONS
========================================================= */

app.delete(
  '/api/notifications/subscribe',
  verifierToken,
  async (req, res) => {

    try {

      const { endpoint } =
        req.body;

      if (!endpoint) {

        return res.status(400).json({
          error:
            'Endpoint manquant'
        });

      }

      await User.updateOne(
        {
          _id:
            req.user.id
        },
        {
          $pull: {
            pushSubscriptions: {
              endpoint:
                endpoint
            }
          }
        }
      );

      res.json({
        message:
          'Souscription supprimee'
      });

    } catch (err) {

      console.error(
        'Erreur suppression souscription:',
        err
      );

      res.status(500).json({
        error:
          err.message
      });

    }

  }
);

/* =========================================================
UTILISATEURS
========================================================= */

app.get(
  '/api/users',
  verifierToken,
  async (req, res) => {

    try {

      const users =
        await User.find({
          _id: {
            $ne:
              req.user.id
          }
        })
        .select(
          '-password -pushSubscriptions'
        )
        .sort({
          lastSeen:
            -1
        });

      res.json(users);

    } catch (err) {

      console.error(
        'Erreur récupération utilisateurs:',
        err
      );

      res.status(500).json({
        error:
          err.message
      });

    }

  }
);

/* =========================================================
COMPTEURS DE MESSAGES NON LUS
========================================================= */

app.get(
  '/api/messages/unread-counts',
  verifierToken,
  async (req, res) => {

    try {

      const results =
        await Message.aggregate([

          {
            $match: {
              receiver:
                new mongoose.Types.ObjectId(
                  req.user.id
                ),

              readAt:
                null
            }
          },

          {
            $group: {
              _id:
                '$sender',

              count: {
                $sum:
                  1
              }
            }
          }

        ]);

      const counts = {};

      results.forEach(
        item => {

          counts[
            item._id.toString()
          ] =
            item.count;

        }
      );

      res.json(counts);

    } catch (err) {

      console.error(
        'Erreur compteurs messages:',
        err
      );

      res.status(500).json({
        error:
          err.message
      });

    }

  }
);

/* =========================================================
MESSAGES D'UNE CONVERSATION
========================================================= */

app.get(
  '/api/messages/:userId',
  verifierToken,
  async (req, res) => {

    try {

      const myId =
        req.user.id;

      const otherId =
        req.params.userId;

      const messages =
        await Message.find({

          $or: [

            {
              sender:
                myId,

              receiver:
                otherId
            },

            {
              sender:
                otherId,

              receiver:
                myId
            }

          ]

        }).sort({
          timestamp:
            1
        });

      await Message.updateMany(
        {
          sender:
            otherId,

          receiver:
            myId,

          readAt:
            null
        },
        {
          readAt:
            new Date()
        }
      );

      res.json(messages);

    } catch (err) {

      console.error(
        'Erreur récupération messages:',
        err
      );

      res.status(500).json({
        error:
          err.message
      });

    }

  }
);

/* =========================================================
MARQUER UNE CONVERSATION COMME LUE
========================================================= */

app.post(
  '/api/messages/:userId/read',
  verifierToken,
  async (req, res) => {

    try {

      await Message.updateMany(
        {
          sender:
            req.params.userId,

          receiver:
            req.user.id,

          readAt:
            null
        },
        {
          readAt:
            new Date()
        }
      );

      res.json({
        message:
          'Messages marques comme lus'
      });

    } catch (err) {

      console.error(
        'Erreur marquage messages:',
        err
      );

      res.status(500).json({
        error:
          err.message
      });

    }

  }
);

/* =========================================================
SUPPRESSION UTILISATEUR
========================================================= */

app.delete(
  '/api/users/:id',
  verifierToken,
  async (req, res) => {

    try {

      if (
        req.user.username !==
        "HIRO'od"
      ) {

        return res.status(403).json({
          error:
            'Action reservee a l administrateur'
        });

      }

      const userId =
        req.params.id;

      await Message.deleteMany({
        $or: [
          {
            sender:
              userId
          },
          {
            receiver:
              userId
          }
        ]
      });

      await User.findByIdAndDelete(
        userId
      );

      res.json({
        message:
          'Utilisateur supprime'
      });

    } catch (err) {

      console.error(
        'Erreur suppression utilisateur:',
        err
      );

      res.status(500).json({
        error:
          err.message
      });

    }

  }
);

/* =========================================================
SERVEUR HTTP + SOCKET.IO
========================================================= */

const server =
  http.createServer(app);

const io =
  socketio(server);

const onlineUsers =
  new Map();

const disconnectTimers =
  new Map();

/* =========================================================
AUTHENTIFICATION SOCKET.IO
========================================================= */

io.use(
  (socket, next) => {

    const token =
      socket.handshake.auth &&
      socket.handshake.auth.token;

    if (!token) {

      return next(
        new Error(
          'Token manquant'
        )
      );

    }

    jwt.verify(
      token,
      'secret_key',
      (err, decoded) => {

        if (err) {

          return next(
            new Error(
              'Token invalide'
            )
          );

        }

        socket.userId =
          decoded.id;

        socket.username =
          decoded.username;

        next();

      }
    );

  }
);

/* =========================================================
STATUT UTILISATEUR
========================================================= */

async function setStatus(
  userId,
  status
) {

  try {

    const now =
      new Date();

    await User.findByIdAndUpdate(
      userId,
      {
        status:
          status,

        lastSeen:
          now
      }
    );

    io.emit(
      'userStatusUpdate',
      {
        userId:
          userId,

        status:
          status,

        lastSeen:
          now
      }
    );

  } catch (err) {

    console.error(
      'Erreur mise a jour statut:',
      err.message
    );

  }

}

/* =========================================================
ENVOYER UNE NOTIFICATION PUSH
========================================================= */

async function envoyerNotificationPush(
  receiverId,
  senderUsername,
  message
) {

  if (
    !VAPID_PUBLIC_KEY ||
    !VAPID_PRIVATE_KEY
  ) {

    return;

  }

  try {

    const receiver =
      await User.findById(
        receiverId
      );

    if (!receiver) {
      return;
    }

    if (
      !receiver.pushSubscriptions ||
      !receiver.pushSubscriptions.length
    ) {

      return;

    }

    const payload =
      JSON.stringify({

        title:
          senderUsername,

        body:
          message,

        icon:
          '/icon-192.png',

        badge:
          '/icon-192.png',

        url:
          '/chat.html',

        senderId:
          receiverId

      });

    const subscriptionsRestantes =
      [];

    for (
      const subscription
      of receiver.pushSubscriptions
    ) {

      try {

        await webpush.sendNotification(
          subscription.toObject(),
          payload
        );

        subscriptionsRestantes.push(
          subscription
        );

      } catch (err) {

        if (
          err.statusCode !== 404 &&
          err.statusCode !== 410
        ) {

          console.error(
            'Erreur notification Push:',
            err.message
          );

          subscriptionsRestantes.push(
            subscription
          );

        }

      }

    }

    receiver.pushSubscriptions =
      subscriptionsRestantes;

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

io.on(
  'connection',
  (socket) => {

    const userId =
      String(
        socket.userId
      );

    /* =====================================================
       ENREGISTRER L'UTILISATEUR CONNECTÉ
    ===================================================== */

    onlineUsers.set(
      userId,
      socket.id
    );

    console.log(
      'Utilisateur connecté en temps réel :',
      userId
    );

    /* =====================================================
       ANNULER UNE ÉVENTUELLE DÉCONNEXION
    ===================================================== */

    if (
      disconnectTimers.has(
        userId
      )
    ) {

      clearTimeout(
        disconnectTimers.get(
          userId
        )
      );

      disconnectTimers.delete(
        userId
      );

    }

    /* =====================================================
       METTRE LE STATUT ACTIF
    ===================================================== */

    setStatus(
      userId,
      'actif'
    );

    /* =====================================================
       HEARTBEAT
    ===================================================== */

    socket.on(
      'heartbeat',
      async () => {

        try {

          await User.findByIdAndUpdate(
            userId,
            {
              lastSeen:
                new Date()
            }
          );

        } catch (err) {

          console.error(
            'Erreur heartbeat:',
            err.message
          );

        }

      }
    );

    /* =====================================================
       ENVOYER MESSAGE
    ===================================================== */

    socket.on(
      'sendMessage',
      async (data, callback) => {

        try {

          if (
            !data ||
            !data.receiverId ||
            !data.message
          ) {

            if (
              typeof callback ===
              'function'
            ) {

              callback({
                ok:
                  false,

                error:
                  'Données du message invalides'
              });

            }

            return;

          }

          const receiverId =
            String(
              data.receiverId
            );

          const messageTexte =
            String(
              data.message
            ).trim();

          if (!messageTexte) {

            if (
              typeof callback ===
              'function'
            ) {

              callback({
                ok:
                  false,

                error:
                  'Message vide'
              });

            }

            return;

          }

          /* ===============================================
             ENREGISTRER LE MESSAGE UNE SEULE FOIS
          =============================================== */

          const newMessage =
            new Message({

              sender:
                userId,

              receiver:
                receiverId,

              message:
                messageTexte,

              timestamp:
                new Date()

            });

          await newMessage.save();

          /* ===============================================
             ENVOYER AU DESTINATAIRE
          =============================================== */

          const receiverSocketId =
            onlineUsers.get(
              receiverId
            );

          if (
            receiverSocketId
          ) {

            io.to(
              receiverSocketId
            ).emit(
              'receiveMessage',
              newMessage
            );

          }

          /* ===============================================
             AFFICHER CHEZ L'EXPÉDITEUR
          =============================================== */

          socket.emit(
            'receiveMessage',
            newMessage
          );

          /* ===============================================
             CONFIRMATION AU HTML
          =============================================== */

          if (
            typeof callback ===
            'function'
          ) {

            callback({

              ok:
                true,

              messageId:
                String(
                  newMessage._id
                )

            });

          }

          /* ===============================================
             NOTIFICATION PUSH
             EN ARRIÈRE-PLAN
          =============================================== */

          envoyerNotificationPush(
            receiverId,
            socket.username,
            messageTexte
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

          if (
            typeof callback ===
            'function'
          ) {

            callback({

              ok:
                false,

              error:
                'Erreur lors de l’envoi du message'

            });

          }

        }

      }
    );

    /* =====================================================
       INDICATEUR "ÉCRIT..."
    ===================================================== */

    socket.on(
      'typing',
      (data) => {

        if (
          !data ||
          !data.receiverId
        ) {

          return;

        }

        const receiverId =
          String(
            data.receiverId
          );

        const receiverSocketId =
          onlineUsers.get(
            receiverId
          );

        if (
          receiverSocketId
        ) {

          io.to(
            receiverSocketId
          ).emit(
            'userTyping',
            {
              senderId:
                userId
            }
          );

        }

      }
    );

    /* =====================================================
       DÉCONNEXION
    ===================================================== */

    socket.on(
      'disconnect',
      () => {

        /*
         * Ne supprimer l'utilisateur de onlineUsers
         * que si ce socket est encore son socket actif.
         */

        if (
          onlineUsers.get(
            userId
          ) === socket.id
        ) {

          onlineUsers.delete(
            userId
          );

        }

        const timer =
          setTimeout(
            () => {

              setStatus(
                userId,
                'inactif'
              );

              disconnectTimers.delete(
                userId
              );

            },
            10000
          );

        disconnectTimers.set(
          userId,
          timer
        );

      }
    );

  }
);

/* =========================================================
MONGODB
========================================================= */

const mongoUri =
  process.env.MONGODB_URI;

if (!mongoUri) {

  console.error(
    'ERREUR : MONGODB_URI est manquante.'
  );

} else {

  mongoose
    .connect(mongoUri)
    .then(
      () => {

        console.log(
          'MongoDB connecte'
        );

      }
    )
    .catch(
      err => {

        console.error(
          'Erreur connexion MongoDB:',
          err
        );

      }
    );

}

/* =========================================================
SERVEUR
========================================================= */

const PORT =
  process.env.PORT || 3000;

server.listen(
  PORT,
  '0.0.0.0',
  () => {

    console.log(
      `Serveur demarre sur le port ${PORT}`
    );

  }
);
