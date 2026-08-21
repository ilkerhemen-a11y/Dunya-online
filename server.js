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
  home: { type: String, default: "Stüdyo Daire" },
  car: { type: String, default: "Yok" },
  stocks: { type: Number, default: 0 },
  workCooldownUntil: { type: Number, default: 0 }, // Çalışma zaman sayacı için bitiş zamanı (timestamp)
  isVip: { type: Boolean, default: false }
});

const User = mongoose.model('User', userSchema);
const onlineUsers = {};

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
        home: playerData.home,
        car: playerData.car,
        stocks: playerData.stocks,
        workCooldownUntil: playerData.workCooldownUntil
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
      const username = (data && data.username && data.username.trim())
        ? data.username.trim()
        : `Vatandas_${Math.floor(1000 + Math.random() * 9000)}`;

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
          home: "Stüdyo Daire",
          car: "Yok",
          stocks: 0,
          workCooldownUntil: 0
        };
        socket.emit('userData', onlineUsers[socket.id]);
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
        home: user.home,
        car: user.car,
        stocks: user.stocks || 0,
        workCooldownUntil: user.workCooldownUntil || 0,
        isVip: user.isVip
      };

      socket.emit('userData', onlineUsers[socket.id]);
    } catch (err) {
      console.error('Giriş Hatası:', err.message);
    }
  });

  // Çalışma (Vardiya) - Kurallarla ve Zaman Sayacıyla
  socket.on('workShift', async () => {
    const player = onlineUsers[socket.id];
    if (!player) return;

    const now = Date.now();
    if (now < player.workCooldownUntil) {
      const remainingSeconds = Math.ceil((player.workCooldownUntil - now) / 1000);
      const hours = Math.floor(remainingSeconds / 3600);
      const minutes = Math.floor((remainingSeconds % 3600) / 60);
      socket.emit('gameLog', `⏳ Henüz dinleniyorsun! Çalışmak için ${hours} saat ${minutes} dakika beklemelisin.`);
      return;
    }

    // İstediğin kurallar: Açlık %0, Enerji %0, Eğlence %50 altı iken çalışma yapılamaz
    if (player.hunger <= 0) {
      socket.emit('gameLog', '❌ Açlığın %0! Karnını doyurmadan çalışamazsın.');
      return;
    }
    if (player.energy <= 0) {
      socket.emit('gameLog', '❌ Enerjin tamamen bitti! Çalışabilmek için önce uymalısın.');
      return;
    }
    if (player.fun < 50) {
      socket.emit('gameLog', '❌ Eğlence seviyen %50’nin altında! Çalışmak için önce eğlenmelisin.');
      return;
    }

    player.balance += 2840;
    player.xp += 25;
    player.energy = Math.max(0, player.energy - 35);
    player.hunger = Math.max(0, player.hunger - 15);
    player.fun = Math.max(0, player.fun - 10);

    // 8 saatlik (gerçekçilik için simülasyonda 10 saniye veya test süresi, tam 8 saat için 8*3600*1000 milisaniye)
    // Şimdilik test kolaylığı veya gerçek 8 saatlik döngü için 8 saat ayarlıyoruz: 8 * 60 * 60 * 1000 ms
    // Test etmek istersen süreyi kısaltabilirsin, buraya tam 8 saatlik sayaç koyuyoruz:
    player.workCooldownUntil = Date.now() + (8 * 60 * 60 * 1000);

    socket.emit('userData', player);
    socket.emit('gameLog', 'Vardiya tamamlandı! +2.840 ₺ kazandın. Yeni vardiya için 8 saat süre başladı.');
  });

  socket.on('eatMeal', async () => {
    const player = onlineUsers[socket.id];
    if (!player) return;
    if (player.balance < 150) {
      socket.emit('gameLog', 'Yemek yemek için yeterli paran yok! (150 ₺ gerekiyor)');
      return;
    }
    player.balance -= 150;
    player.hunger = Math.min(100, player.hunger + 25);
    socket.emit('userData', player);
    socket.emit('gameLog', 'Karnın doyuruldu, açlık seviyen arttı.');
  });

  socket.on('sleepTime', async () => {
    const player = onlineUsers[socket.id];
    if (!player) return;
    if (player.balance < 200) {
      socket.emit('gameLog', 'Dinlenmek için yeterli paran yok! (200 ₺ gerekiyor)');
      return;
    }
    player.balance -= 200;
    player.energy = 100;
    socket.emit('userData', player);
    socket.emit('gameLog', 'Uykunu aldın, enerji tamamen yenilendi.');
  });

  socket.on('haveFun', async () => {
    const player = onlineUsers[socket.id];
    if (!player) return;
    if (player.balance < 500) {
      socket.emit('gameLog', 'Eğlence aktivitesi için yeterli paran yok! (500 ₺ gerekiyor)');
      return;
    }
    player.balance -= 500;
    player.fun = 100;
    socket.emit('userData', player);
    socket.emit('gameLog', 'Eğlence aktivitesine katıldın, motivasyonun arttı.');
  });

  socket.on('buyStock', async () => {
    const player = onlineUsers[socket.id];
    if (!player) return;
    if (player.balance < 1500) {
      socket.emit('gameLog', 'Borsadan hisse almak için yeterli paran yok! (1.500 ₺ gerekiyor)');
      return;
    }
    player.balance -= 1500;
    player.stocks += 1;
    socket.emit('userData', player);
    socket.emit('gameLog', '📈 Borsadan 1 adet hisse alındı.');
  });

  socket.on('collectDividends', async () => {
    const player = onlineUsers[socket.id];
    if (!player) return;
    if (player.stocks <= 0) {
      socket.emit('gameLog', 'Temettü alabilmek için hissen olmalı!');
      return;
    }
    const profit = player.stocks * 350;
    player.balance += profit;
    socket.emit('userData', player);
    socket.emit('gameLog', `💰 ${profit.toLocaleString('tr-TR')} ₺ temettü toplandı.`);
  });

  socket.on('upgradeBuild', async () => {
    const player = onlineUsers[socket.id];
    if (!player) return;
    if (player.balance < 5000) {
      socket.emit('gameLog', 'Yetersiz bakiye! (5.000 ₺ gerekiyor)');
      return;
    }
    player.balance -= 5000;
    player.home = "Lüks Loft Daire";
    player.car = "Spor Araç";
    player.cityRank = Math.max(1, player.cityRank - 250);
    socket.emit('userData', player);
    socket.emit('gameLog', '🏗️ Build tamamlandı, statün yükseldi!');
  });

  socket.on('climbRank', async () => {
    const player = onlineUsers[socket.id];
    if (!player) return;
    player.cityRank = Math.max(1, player.cityRank - 50);
    socket.emit('userData', player);
    socket.emit('gameLog', '🏆 Liderlik tablosunda tırmandın.');
  });

  socket.on('buyTimeSkip', async () => {
    const player = onlineUsers[socket.id];
    if (!player) return;
    if (player.balance < 1000) {
      socket.emit('gameLog', 'Zamanı hızlandırmak için 1.000 ₺ gerekiyor.');
      return;
    }
    player.balance -= 1000;
    player.workCooldownUntil = 0; // Süreyi sıfırlar, hemen çalışmayı açar!
    player.hunger = Math.min(100, player.hunger + 30);
    player.energy = 100;
    player.fun = 100;
    socket.emit('userData', player);
    socket.emit('gameLog', '⚡ Zaman atlandı! Bekleme süreleri sıfırlandı ve ihtiyaçlar doldu.');
  });

  socket.on('disconnect', async () => {
    await saveUserData(socket.id);
    delete onlineUsers[socket.id];
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});
