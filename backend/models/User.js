const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  photoProfil: { type: String, default: '' },
  status: { type: String, enum: ['actif', 'inactif'], default: 'inactif' },
  lastSeen: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
