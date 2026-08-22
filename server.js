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
  balance: { type: Number, default: 12480 },
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
        : `Vatandas_${Math.floor(1000 + Math.random() * 9000)}`;

      if (Object.values(onlineUsers).some(u => u.username === username)) {
        username = username + '_' + Math.floor(10 + Math.random() * 90);
      }

      if (mongoose.connection.readyState !== 1) {
        onlineUsers[socket.id] = {
          id: socket.id,
          username,
          balance: 12480,
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

  const catalogItems = {
    'studio_home': { name: 'Stüdyo Daire', cost: 5000, hourly: 450, type: 'home' },
    'luxury_residence': { name: 'Lüks Rezidans', cost: 15000, hourly: 1250, type: 'home' },
    'sports_car': { name: 'Spor Otomobil', cost: 10000, hourly: 850, type: 'car' },
    'super_car': { name: 'Süper Araba', cost: 25000, hourly: 2200, type: 'car' }
  };

  socket.on('buyProperty', (id) => {
    const player = onlineUsers[socket.id];
    if (!player) return;
    const item = catalogItems[id];
    if (!item) return;

    if (player.properties.has(id)) {
      socket.emit('gameLog', '❌ Bu varlığa zaten sahipsin! Üzerinden yükseltme yapabilirsin.');
      return;
    }

    if (player.balance < item.cost) {
      socket.emit('gameLog', `❌ Yeterli paran yok! Gereken: ${item.cost.toLocaleString('tr-TR')} ₺`);
      return;
    }

    player.balance -= item.cost;
    player.properties.set(id, {
      level: 1,
      pendingBalance: 0,
      lastCollected: Date.now()
    });

    player.cityRank = Math.max(1, player.cityRank - 200);
    socket.emit('userData', player);
    broadcastOnlineList();
    socket.emit('gameLog', `🎉 Başarıyla satın alındı: ${item.name}`);
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

    const totalToCollect = prop.pendingBalance + earned;
    if (totalToCollect <= 0) {
      socket.emit('gameLog', '⏳ Henüz toplanacak bir kazanç birikmedi.');
      return;
    }

    player.balance += totalToCollect;
    prop.pendingBalance = 0;
    prop.lastCollected = now;
    player.properties.set(id, prop);

    socket.emit('userData', player);
    socket.emit('gameLog', `💰 ${totalToCollect.toLocaleString('tr-TR')} ₺ kasaya aktarıldı!`);
  });

  socket.on('upgradeProperty', (id) => {
    const player = onlineUsers[socket.id];
    if (!player) return;
    const prop = player.properties.get(id);
    const item = catalogItems[id];
    if (!prop || !item) return;

    const upgradeCost = Math.floor(item.cost * 0.5 * prop.level);
    if (player.balance < upgradeCost) {
      socket.emit('gameLog', `❌ Yükseltmek için ${upgradeCost.toLocaleString('tr-TR')} ₺ gerekiyor.`);
      return;
    }

    player.balance -= upgradeCost;
    prop.level += 1;
    player.properties.set(id, prop);

    socket.emit('userData', player);
    socket.emit('gameLog', `🚀 ${item.name} Sv.${prop.level} seviyesine yükseltildi!`);
  });

  socket.on('workShift', async () => {
    const player = onlineUsers[socket.id];
    if (!player) return;
    const now = Date.now();

    if (player.loanDebt > 0 && now >= player.nextLoanPaymentDue) {
      if (player.balance >= player.loanInstallment) {
        player.balance -= player.loanInstallment;
        player.loanDebt = Math.max(0, player.loanDebt - player.loanInstallment);
        player.nextLoanPaymentDue = now + (3 * 60 * 1000);
        socket.emit('gameLog', `💳 Kredi taksiti ödendi. Kalan borç: ${player.loanDebt} ₺`);
      }
    }

    if (now < player.workCooldownUntil) {
      const remainingSeconds = Math.ceil((player.workCooldownUntil - now) / 1000);
      const m = Math.floor(remainingSeconds / 60);
      const s = remainingSeconds % 60;
      socket.emit('gameLog', `⏳ Dinleniyorsun: ${m}d ${s}s beklemelisin.`);
      return;
    }

    if (player.hunger <= 0 || player.energy <= 0 || player.fun < 50) {
      socket.emit('gameLog', '❌ İhtiyaçların yetersiz (Açlık, Enerji veya Eğlence düşük).');
      return;
    }

    player.balance += 2840;
    player.energy = Math.max(0, player.energy - 35);
    player.hunger = Math.max(0, player.hunger - 15);
    player.fun = Math.max(0, player.fun - 10);
    player.workCooldownUntil = Date.now() + (8 * 60 * 1000);

    socket.emit('userData', player);
    socket.emit('gameLog', 'Vardiya tamamlandı! +2.840 ₺ kazandın.');
  });

  socket.on('eatMeal', async () => {
    const player = onlineUsers[socket.id];
    if (!player || player.balance < 150) return;
    player.balance -= 150;
    player.hunger = Math.min(100, player.hunger + 25);
    socket.emit('userData', player);
  });

  socket.on('sleepTime', async () => {
    const player = onlineUsers[socket.id];
    if (!player || player.balance < 200) return;
    player.balance -= 200;
    player.energy = 100;
    socket.emit('userData', player);
  });

  socket.on('haveFun', async () => {
    const player = onlineUsers[socket.id];
    if (!player || player.balance < 500) return;
    player.balance -= 500;
    player.fun = 100;
    socket.emit('userData', player);
  });

  socket.on('buyStock', async () => {
    const player = onlineUsers[socket.id];
    if (!player || player.balance < 1500) return;
    player.balance -= 1500;
    player.stocks += 1;
    socket.emit('userData', player);
    socket.emit('gameLog', '📈 1 adet hisse alındı.');
  });

  socket.on('collectDividends', async () => {
    const player = onlineUsers[socket.id];
    if (!player || player.stocks <= 0) return;
    const profit = player.stocks * 350;
    player.balance += profit;
    socket.emit('userData', player);
    socket.emit('gameLog', `💰 ${profit} ₺ temettü alındı.`);
  });

  socket.on('disconnect', async () => {
    await saveUserData(socket.id);
    const playerName = onlineUsers[socket.id]?.username;
    delete onlineUsers[socket.id];
    broadcastOnlineList();
    if (playerName) {
      io.emit('chatMessage', { sender: 'Sistem', text: `${playerName} ayrıldı.` });
    }
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});
