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
  stocks: { type: Number, default: 0 }, // Earn Borsa hisse adedi
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
        stocks: playerData.stocks
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
          stocks: 0
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
        isVip: user.isVip
      };

      socket.emit('userData', onlineUsers[socket.id]);
    } catch (err) {
      console.error('Giriş Hatası:', err.message);
    }
  });

  // Çalışma (Vardiya)
  socket.on('workShift', async () => {
    const player = onlineUsers[socket.id];
    if (!player) return;

    if (player.energy < 30) {
      socket.emit('gameLog', 'Çok yorgunsun! Çalışabilmek için önce uyumalısın.');
      return;
    }

    player.balance += 2840;
    player.xp += 25;
    player.energy = Math.max(0, player.energy - 35);
    player.hunger = Math.max(0, player.hunger - 15);

    socket.emit('userData', player);
    socket.emit('gameLog', 'Vardiya tamamlandı! +2.840 ₺ kazandın.');
  });

  // Yemek Ye (Nourish)
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
    socket.emit('gameLog', 'Karnın doyuruldu, enerjin yerine geldi.');
  });

  // Uyku / Dinlenme
  socket.on('sleepTime', async () => {
    const player = onlineUsers[socket.id];
    if (!player) return;

    if (player.balance < 200) {
      socket.emit('gameLog', 'Otel masrafı için yeterli paran yok! (200 ₺ gerekiyor)');
      return;
    }

    player.balance -= 200;
    player.energy = 100;

    socket.emit('userData', player);
    socket.emit('gameLog', '8 saat uyku çekildi, enerji tamamen yenilendi.');
  });

  // Eğlence
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

  // EARN - Borsa Sistemi (Hisse Senedi Al / Yatırım Yap)
  socket.on('buyStock', async () => {
    const player = onlineUsers[socket.id];
    if (!player) return;

    const stockPrice = 1500; // 1 adet hisse bedeli
    if (player.balance < stockPrice) {
      socket.emit('gameLog', 'Borsadan hisse almak için yeterli paran yok! (1.500 ₺ gerekiyor)');
      return;
    }

    player.balance -= stockPrice;
    player.stocks += 1;
    player.xp += 40;

    socket.emit('userData', player);
    socket.emit('gameLog', '📈 Borsadan 1 adet UrbanTech hissesi satın aldın! Gelir büyüyor.');
  });

  // EARN - Temettü Topla (Borsadan Kâr Payı Al)
  socket.on('collectDividends', async () => {
    const player = onlineUsers[socket.id];
    if (!player) return;

    if (player.stocks <= 0) {
      socket.emit('gameLog', 'Temettü alabilmek için önce bütçeden hisse senedi almalısın!');
      return;
    }

    const profit = player.stocks * 350; // Hisse başına 350 TL kâr
    player.balance += profit;

    socket.emit('userData', player);
    socket.emit('gameLog', `💰 Borsadaki yatırımlarından ${profit.toLocaleString('tr-TR')} ₺ temettü (kâr payi) topladın!`);
  });

  // BUILD - Ev/Araç Yatırımı Yaparak Statü Artırma
  socket.on('upgradeBuild', async () => {
    const player = onlineUsers[socket.id];
    if (!player) return;

    const upgradeCost = 5000;
    if (player.balance < upgradeCost) {
      socket.emit('gameLog', 'Statünü artırmak (Build) için yeterli paran yok! (5.000 ₺ gerekiyor)');
      return;
    }

    player.balance -= upgradeCost;
    player.home = "Lüks Loft Daire";
    player.car = "Spor Araç";
    player.cityRank = Math.max(1, player.cityRank - 250); // Sıralamada ciddi tırmanış

    socket.emit('userData', player);
    socket.emit('gameLog', '🏗️ Build aşaması tamamlandı! Lüks Loft daireye ve spor araca sahip oldun, statün fırladı.');
  });

  // CLIMB - Liderlik Tablosunda Zirveye Tırmanma Hamlesi
  socket.on('climbRank', async () => {
    const player = onlineUsers[socket.id];
    if (!player) return;

    if (player.cityRank <= 1) {
      socket.emit('gameLog', 'Zaten şehrin zirvesindesin!');
      return;
    }

    player.cityRank = Math.max(1, player.cityRank - 50);
    player.xp += 50;

    socket.emit('userData', player);
    socket.emit('gameLog', '🏆 Climb hamlesi yapıldı! Liderlik tablosunda üst sıralara tırmandın.');
  });

  // Zaman Hızlandırma (Time Skip)
  socket.on('buyTimeSkip', async () => {
    const player = onlineUsers[socket.id];
    if (!player) return;

    const skipCost = 1000;
    if (player.balance < skipCost) {
      socket.emit('gameLog', 'Zamanı hızlandırmak için yeterli paran yok! (1.000 ₺ gerekiyor)');
      return;
    }

    player.balance -= skipCost;
    player.xp += 100;
    player.hunger = Math.min(100, player.hunger + 30);
    player.energy = Math.min(100, player.energy + 30);
    player.fun = Math.min(100, player.fun + 30);
    player.cityRank = Math.max(1, player.cityRank - 20);

    socket.emit('userData', player);
    socket.emit('gameLog', '⚡ Zaman hızlandırıldı! Bonus XP kazandın.');
  });

  socket.on('disconnect', async () => {
    await saveUserData(socket.id);
    delete onlineUsers[socket.id];
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`UrbanRise sunucusu ${PORT} portunda başlatıldı.`);
});
