const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const verifierToken = require('../middleware/auth');

router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Nom utilisateur et mot de passe requis' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ username, password: hashedPassword, status: 'inactif', lastSeen: new Date() });
    await newUser.save();
    res.status(201).json({ message: 'Utilisateur cree avec succes' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ error: 'Utilisateur introuvable' });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Mot de passe incorrect' });
    }
    user.lastSeen = new Date();
    await user.save();
    const token = jwt.sign({ id: user._id, username: user.username }, 'secret_key', { expiresIn: '30d' });
    res.json({ token, username: user.username, userId: user._id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/me', verifierToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
