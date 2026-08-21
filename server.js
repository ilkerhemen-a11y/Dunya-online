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

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  balance: { type: Number, default: 1250 }, // 12480 -> 1250
  level: { type: Number, default: 1 },
  xp: { type: Number, default: 0 },
  hunger: { type: Number, default: 82 },
  energy: { type: Number, default: 100 },
  fun: { type: Number, default: 100 },
  cityRank: { type: Number, default: 2841 },
  stocks: { type: Number, default: 0 },
  workCooldownUntil: { type: Number, default: 0 },
  loanDebt: { type: Number, default: 0 },
  loanInstallment: { type: Number, default: 0 },
  nextLoanPaymentDue: { type: Number, default: 0 },
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
        xp: playerData.xp,
        hunger: playerData.hunger,
        energy: playerData.energy,
        fun: playerData.fun,
        cityRank: playerData.cityRank,
        stocks: playerData.stocks,
        workCooldownUntil: playerData.workCooldownUntil,
        loanDebt: playerData.loanDebt,
        loanInstallment: playerData.loanInstallment,
        nextLoanPaymentDue: playerData.nextLoanPaymentDue,
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
          xp: 0,
          hunger: 82,
          energy: 100,
          fun: 100,
          cityRank: 2841,
          stocks: 0,
          workCooldownUntil: 0,
          loanDebt: 0,
          loanInstallment: 0,
          nextLoanPaymentDue: 0,
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
        xp: user.xp,
        hunger: user.hunger,
        energy: user.energy,
        fun: user.fun,
        cityRank: user.cityRank,
        stocks: user.stocks || 0,
        workCooldownUntil: user.workCooldownUntil || 0,
        loanDebt: user.loanDebt || 0,
        loanInstallment: user.loanInstallment || 0,
        nextLoanPaymentDue: user.nextLoanPaymentDue || 0,
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

  // Fantezi Katalogu
  const catalogItems = {
    'hut': { name: 'Kulübe', cost: 500, hourly: 45, type: 'home' },
    'mansion': { name: 'Köşk', cost: 1500, hourly: 125, type: 'home' },
    'war_horse': { name: 'Savaş Atı', cost: 1000, hourly: 85, type: 'car' },
    'magic_tower': { name: 'Büyü Kulesi', cost: 2500, hourly: 220, type: 'special' }
  };

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
      socket.emit('gameLog', `❌ Yeterli altının yok! Gereken: ${item.cost}`);
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

    player.balance += 280;
    player.energy = Math.max(0, player.energy - 35);
    player.hunger = Math.max(0, player.hunger - 15);
    player.workCooldownUntil = Date.now() + (8 * 60 * 1000);

    socket.emit('userData', player);
    socket.emit('gameLog', 'Zanaat tamamlandı! +280 Altın kazandın.');
  });

  // Diğer işlemler (eatMeal, sleepTime vb.) buraya benzer şekilde güncellenebilir.
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
