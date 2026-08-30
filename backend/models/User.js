const mongoose = require('mongoose');

const pushSubscriptionSchema = new mongoose.Schema({
endpoint: { type: String, required: true },
expirationTime: { type: Number, default: null },
keys: {
p256dh: { type: String, required: true },
auth: { type: String, required: true }
}
}, { _id: false });

const userSchema = new mongoose.Schema({
username: { type: String, required: true, unique: true },
password: { type: String, required: true },
photoProfil: { type: String, default: '' },

status: {
type: String,
enum: ['actif', 'inactif'],
default: 'inactif'
},

lastSeen: {
type: Date,
default: Date.now
},

pushSubscriptions: {
type: [pushSubscriptionSchema],
default: []
}
});

module.exports = mongoose.model('User', userSchema);
