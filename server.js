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
  cityRank: { type: Number, default: 2841 },
  home: { type: String, default: "Stüdyo Daire" },
  car: { type: String, default: "Yok" },
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
        cityRank: playerData.cityRank,
        home: playerData.home,
        car: playerData.car
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
          cityRank: 2841,
          home: "Stüdyo Daire",
          car: "Yok"
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
        cityRank: user.cityRank,
        home: user.home,
        car: user.car,
        isVip: user.isVip
      };

      socket.emit('userData', onlineUsers[socket.id]);
    } catch (err) {
      console.error('Giriş Hatası:', err.message);
    }
  });

  socket.on('workShift', async () => {
    const player = onlineUsers[socket.id];
    if (!player) return;

    player.balance += 2840;
    player.xp += 25;
    player.hunger = Math.max(0, player.hunger - 10);

    socket.emit('userData', player);
    socket.emit('gameLog', 'Vardiya tamamlandı! +2.840 ₺ kazandın.');
  });

  socket.on('eatMeal', async () => {
    const player = onlineUsers[socket.id];
    if (!player) return;

    if (player.balance < 150) {
      socket.emit('gameLog', 'Yemek yemek için yeterli paran yok! (150 ₺ gerekiyor)');
      return;
    }

    player.balance -= 150;
    player.hunger = Math.min(100, player.hunger + 20);

    socket.emit('userData', player);
    socket.emit('gameLog', 'Karnın doyuruldu! Açlık seviyen yükseldi.');
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
