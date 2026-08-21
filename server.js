const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static('public'));

// MongoDB Bağlantısı (Kendi URI'nı kullanmayı unutma)
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/mafia_game';
mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Bağlandı!'))
  .catch(err => console.error('Hata:', err.message));

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  balance: { type: Number, default: 12480 },
  level: { type: Number, default: 1 },
  xp: { type: Number, default: 0 },
  hunger: { type: Number, default: 82 },
  energy: { type: Number, default: 100 },
  fun: { type: Number, default: 100 },
  cityRank: { type: Number, default: 2841 },
  stocks: { type: Number, default: 0 },
  workCooldownUntil: { type: Number, default: 0 },
  properties: { type: Map, of: Object, default: {} }
});

const User = mongoose.model('User', userSchema);
const onlineUsers = {};

// Kataloglar
const catalogItems = {
  'studio_home': { name: 'Stüdyo Daire', cost: 5000, hourly: 450 },
  'luxury_residence': { name: 'Lüks Rezidans', cost: 15000, hourly: 1250 },
  'sports_car': { name: 'Spor Otomobil', cost: 10000, hourly: 850 },
  'super_car': { name: 'Süper Araba', cost: 25000, hourly: 2200 }
};

const crimeLevels = {
  'pickpocket': { name: 'Yankesicilik', risk: 10, reward: 500, energy: 10 },
  'shoplift': { name: 'Dükkan Soygunu', risk: 25, reward: 2500, energy: 30 },
  'bank_robbery': { name: 'Banka Soygunu', risk: 60, reward: 15000, energy: 70 }
};

io.on('connection', (socket) => {
  socket.on('userLogin', async (data) => {
    let username = data.username || `User_${Math.floor(Math.random()*1000)}`;
    let user = await User.findOne({ username });
    if (!user) user = await User.create({ username });

    onlineUsers[socket.id] = { ...user.toObject(), dbId: user._id, id: socket.id };
    socket.emit('userData', onlineUsers[socket.id]);
  });

  // Mülk İşlemleri
  socket.on('buyProperty', (id) => {
    const player = onlineUsers[socket.id];
    const item = catalogItems[id];
    if (!player || !item || player.properties[id] || player.balance < item.cost) return;

    player.balance -= item.cost;
    player.properties[id] = { level: 1, pendingBalance: 0, lastCollected: Date.now() };
    socket.emit('userData', player);
  });

  socket.on('collectProperty', (id) => {
    const player = onlineUsers[socket.id];
    const prop = player.properties[id];
    const item = catalogItems[id];
    if (!prop || !item) return;

    const hoursElapsed = (Date.now() - prop.lastCollected) / (60 * 1000);
    const earned = Math.floor(hoursElapsed * (item.hourly * prop.level));
    
    player.balance += earned;
    prop.lastCollected = Date.now();
    socket.emit('userData', player);
    socket.emit('gameLog', `💰 ${earned} ₺ toplandı.`);
  });

  socket.on('upgradeProperty', (id) => {
    const player = onlineUsers[socket.id];
    const prop = player.properties[id];
    const item = catalogItems[id];
    const cost = Math.floor(item.cost * 0.5 * prop.level);

    if (player.balance >= cost) {
      player.balance -= cost;
      prop.level += 1;
      socket.emit('userData', player);
      socket.emit('gameLog', `${item.name} seviye ${prop.level} oldu!`);
    }
  });

  // Suç İşlemleri
  socket.on('performCrime', (crimeId) => {
    const player = onlineUsers[socket.id];
    const crime = crimeLevels[crimeId];
    if (!player || !crime || player.energy < crime.energy) return;

    player.energy -= crime.energy;
    if (Math.random() * 100 > crime.risk) {
      player.balance += crime.reward;
      socket.emit('gameLog', `✅ ${crime.name} başarılı! +${crime.reward} ₺`);
    } else {
      player.balance = Math.max(0, player.balance - (crime.reward / 2));
      socket.emit('gameLog', `🚨 ${crime.name} başarısız! Polis yakaladı.`);
    }
    socket.emit('userData', player);
  });

  // Diğer Temel İşlemler
  socket.on('workShift', () => {
    const player = onlineUsers[socket.id];
    if (player.energy >= 35) {
      player.balance += 2840;
      player.energy -= 35;
      socket.emit('userData', player);
      socket.emit('gameLog', 'Vardiya tamamlandı.');
    }
  });

  socket.on('disconnect', async () => {
    const p = onlineUsers[socket.id];
    if (p) await User.findByIdAndUpdate(p.dbId, p);
    delete onlineUsers[socket.id];
  });
});

server.listen(10000, () => console.log('Sunucu 10000 portunda çalışıyor.'));
