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

// MongoDB Bağlantısı (Çökmeyi Önleyen Yapı)
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('HATA: MONGO_URI ortam değişkeni eksik!');
} else {
  mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB Veritabanına Başarıyla Bağlanıldı!'))
    .catch(err => console.error('MongoDB BAGLANTI HATASI:', err.message));
}

// Kullanıcı Şeması
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  balance: { type: Number, default: 1000 },
  level: { type: Number, default: 1 },
  xp: { type: Number, default: 0 },
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
        xp: playerData.xp
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
        : `Ziyaretçi_${Math.floor(1000 + Math.random() * 9000)}`;

      if (mongoose.connection.readyState !== 1) {
        console.error('Veritabanı bağlantısı yok, geçici oturum açılıyor.');
        onlineUsers[socket.id] = { id: socket.id, username, balance: 1000, level: 1, xp: 0 };
        socket.emit('userData', onlineUsers[socket.id]);
        return;
      }

      let user = await User.findOne({ username });
      if (!user) {
        user = await User.create({ username });
        console.log(`Yeni oyuncu oluşturuldu: ${username}`);
      }

      onlineUsers[socket.id] = {
        id: socket.id,
        dbId: user._id,
        username: user.username,
        balance: user.balance,
        level: user.level,
        xp: user.xp,
        isVip: user.isVip
      };

      socket.emit('userData', onlineUsers[socket.id]);
    } catch (err) {
      console.error('Giriş Hatası:', err.message);
    }
  });

  socket.on('disconnect', async () => {
    await saveUserData(socket.id);
    delete onlineUsers[socket.id];
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda başarıyla başlatıldı.`);
});
