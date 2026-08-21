const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static('public'));

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('HATA: MONGO_URI ortam değişkeni eksik!');
} else {
  mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB Veritabanına Başarıyla Bağlanıldı!'))
    .catch(err => console.error('MongoDB BAGLANTI HATASI:', err.message));
}

// 10 Meslek Tanımı ve Özellikleri
const JOBS = {
  'ciftci': { name: 'Çiftçi', income: 150, energyCost: 20, hungerCost: 10 },
  'demirci': { name: 'Demirci', income: 280, energyCost: 35, hungerCost: 15 },
  'muhafiz': { name: 'Muhafız', income: 300, energyCost: 30, hungerCost: 12 },
  'hanci': { name: 'Hancı', income: 200, energyCost: 25, hungerCost: 10 },
  'buyucu': { name: 'Büyücü', income: 350, energyCost: 40, hungerCost: 15 },
  'tuccar': { name: 'Tüccar', income: 320, energyCost: 30, hungerCost: 12 },
  'hirsiz': { name: 'Hırsız', income: 500, energyCost: 40, hungerCost: 20 },
  'avci': { name: 'Avcı', income: 400, energyCost: 45, hungerCost: 25 },
  'sifaci': { name: 'Şifacı', income: 250, energyCost: 20, hungerCost: 10 },
  'soylu': { name: 'Soylu', income: 0, energyCost: 0, hungerCost: 0 }
};

// Fantezi Katalogu (Dengelenmiş 72 Saatlik Amorti Modeli)
const catalogItems = {
  'hut': { name: 'Kulübe', cost: 2500, hourly: 35, type: 'home' },
  'mansion': { name: 'Köşk', cost: 6000, hourly: 85, type: 'home' },
  'war_horse': { name: 'Savaş Atı', cost: 4000, hourly: 55, type: 'car' },
  'magic_tower': { name: 'Büyü Kulesi', cost: 10000, hourly: 140, type: 'special' }
};

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  balance: { type: Number, default: 1250 },
  level: { type: Number, default: 1 },
  exp: { type: Number, default: 0 },
  statPoints: { type: Number, default: 5 },
  vit: { type: Number, default: 5 },
  int: { type: Number, default: 5 },
  str: { type: Number, default: 5 },
  dex: { type: Number, default: 5 },
  cityRank: { type: Number, default: 2841 },
  job: { type: String, default: 'demirci' },
  completedQuests: { type: [String], default: [] },
  stocks: { type: Number, default: 0 },
  workCooldownUntil: { type: Number, default: 0 },
  properties: {
    type: Map,
    of: new mongoose.Schema({
      level: { type: Number, default: 1 },
      pendingBalance: { type: Number, default: 0 },
      lastCollected: { type: Number, default: Date.now }
    }),
    default: {}
  }
});

const User = mongoose.model('User', userSchema);
const onlineUsers = {};

function broadcastOnlineList() {
  const list = Object.values(onlineUsers).map(u => ({
    username: u.username,
    job: u.job || 'demirci',
    propertyCount: Object.keys(u.properties || {}).length
  }));
  io.emit('onlineUsersList', list);
}

async function saveUserData(socketId) {
  const playerData = onlineUsers[socketId];
  if (playerData && playerData.dbId && mongoose.connection.readyState === 1) {
    try {
      await User.findByIdAndUpdate(playerData.dbId, {
        balance: playerData.balance,
        level: playerData.level,
        exp: playerData.exp,
        statPoints: playerData.statPoints,
        vit: playerData.vit,
        int: playerData.int,
        str: playerData.str,
        dex: playerData.dex,
        cityRank: playerData.cityRank,
        job: playerData.job,
        completedQuests: playerData.completedQuests,
        stocks: playerData.stocks,
        workCooldownUntil: playerData.workCooldownUntil,
        properties: playerData.properties
      });
    } catch (err) {
      console.error('Veri kaydetme hatası:', err.message);
    }
  }
}

io.on('connection', (socket) => {
  console.log('Yeni bağlantı:', socket.id);

  socket.on('userLogin', async (data) => {
    try {
      let username = (data && data.username && data.username.trim())
        ? data.username.trim()
        : `Yolcu_${Math.floor(1000 + Math.random() * 9000)}`;

      if (Object.values(onlineUsers).some(u => u.username === username)) {
        username = username + '_' + Math.floor(10 + Math.random() * 90);
      }

      if (mongoose.connection.readyState !== 1) {
        onlineUsers[socket.id] = {
          id: socket.id,
          username,
          balance: 1250,
          level: 1,
          exp: 0,
          statPoints: 5,
          vit: 5,
          int: 5,
          str: 5,
          dex: 5,
          cityRank: 2841,
          job: 'demirci',
          completedQuests: [],
          stocks: 0,
          workCooldownUntil: 0,
          properties: {}
        };
        socket.emit('userData', onlineUsers[socket.id]);
        broadcastOnlineList();
        return;
      }

      let user = await User.findOne({ username });
      if (!user) {
        user = await User.create({ username });
      }

      onlineUsers[socket.id] = {
        id: socket.id,
        dbId: user._id,
        username: user.username,
        balance: user.balance,
        level: user.level,
        exp: user.exp || 0,
        statPoints: user.statPoints ?? 5,
        vit: user.vit ?? 5,
        int: user.int ?? 5,
        str: user.str ?? 5,
        dex: user.dex ?? 5,
        cityRank: user.cityRank,
        job: user.job || 'demirci',
        completedQuests: user.completedQuests || [],
        stocks: user.stocks || 0,
        workCooldownUntil: user.workCooldownUntil || 0,
        properties: user.properties || {}
      };

      socket.emit('userData', onlineUsers[socket.id]);
      broadcastOnlineList();
    } catch (err) {
      console.error('Giriş Hatası:', err.message);
    }
  });

  socket.on('sendChat', (text) => {
    const player = onlineUsers[socket.id];
    if (!player || !text || text.trim() === '') return;
    const cleanText = text.trim().substring(0, 250);
    io.emit('chatMessage', { sender: player.username, text: cleanText });
  });

  socket.on('selectJob', (jobId) => {
    const player = onlineUsers[socket.id];
    if (!player || !JOBS[jobId]) return;

    player.job = jobId;
    socket.emit('userData', player);
    broadcastOnlineList();
    socket.emit('gameLog', `📜 Mesleğin başarıyla "${JOBS[jobId].name}" olarak değiştirildi!`);
  });

  socket.on('distributeStat', (statName) => {
    const player = onlineUsers[socket.id];
    if (!player) return;

    if (player.statPoints <= 0) {
      socket.emit('gameLog', '❌ Dağıtılabilir stat puanın kalmadı!');
      return;
    }

    if (['vit', 'int', 'str', 'dex'].includes(statName)) {
      player[statName] += 1;
      player.statPoints -= 1;
      socket.emit('userData', player);
      socket.emit('gameLog', `✨ ${statName.toUpperCase()} statı yükseltildi!`);
    }
  });

  socket.on('buyProperty', (id) => {
    const player = onlineUsers[socket.id];
    if (!player) return;
    const item = catalogItems[id];
    if (!item) return;

    if (player.properties.has(id)) {
      socket.emit('gameLog', '❌ Bu tımara zaten sahipsin!');
      return;
    }

    if (player.balance < item.cost) {
      socket.emit('gameLog', `❌ Yeterli altının yok! Gereken: ${item.cost} Altın`);
      return;
    }

    player.balance -= item.cost;
    player.properties.set(id, { level: 1, pendingBalance: 0, lastCollected: Date.now() });

    socket.emit('userData', player);
    broadcastOnlineList();
    socket.emit('gameLog', `🎉 Başarıyla edinildi: ${item.name}`);
  });

  socket.on('collectProperty', (id) => {
    const player = onlineUsers[socket.id];
    if (!player) return;
    const prop = player.properties.get(id);
    const item = catalogItems[id];
    if (!prop || !item) return;

    const now = Date.now();
    const hoursElapsed = (now - prop.lastCollected) / (60 * 1000);
    const earned = Math.floor(hoursElapsed * (item.hourly * prop.level));

    if (earned <= 0) {
      socket.emit('gameLog', '⏳ Henüz gelir birikmedi.');
      return;
    }

    player.balance += earned;
    prop.lastCollected = now;
    player.properties.set(id, prop);

    socket.emit('userData', player);
    socket.emit('gameLog', `💰 ${earned} Altın hazineye aktarıldı!`);
  });

  socket.on('upgradeProperty', (id) => {
    const player = onlineUsers[socket.id];
    if (!player) return;
    const prop = player.properties.get(id);
    const item = catalogItems[id];
    if (!prop || !item) return;

    const upgradeCost = Math.floor(item.cost * 0.5 * prop.level);
    if (player.balance < upgradeCost) {
      socket.emit('gameLog', `❌ Yükseltmek için ${upgradeCost} Altın gerekli.`);
      return;
    }

    player.balance -= upgradeCost;
    prop.level += 1;
    player.properties.set(id, prop);

    socket.emit('userData', player);
    socket.emit('gameLog', `🚀 ${item.name} Seviye ${prop.level} oldu!`);
  });

  socket.on('workShift', async () => {
    const player = onlineUsers[socket.id];
    if (!player) return;
    const now = Date.now();

    if (now < player.workCooldownUntil) {
      socket.emit('gameLog', '⏳ Zanaat için dinlenmelisin.');
      return;
    }

    const currentJob = JOBS[player.job] || JOBS['demirci'];

    player.balance += currentJob.income;
    player.workCooldownUntil = Date.now() + (8 * 60 * 1000);

    socket.emit('userData', player);
    socket.emit('gameLog', `⚔️ ${currentJob.name} görevi tamamlandı! +${currentJob.income} Altın kazandın.`);
  });

  socket.on('disconnect', async () => {
    await saveUserData(socket.id);
    delete onlineUsers[socket.id];
    broadcastOnlineList();
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Taht Savaşı sunucusu ${PORT} portunda çalışıyor.`);
});
