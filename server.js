const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Static Dosyalar
app.use(express.static('public'));

// MongoDB Bağlantısı
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('HATA: MONGO_URI ortam değişkeni tanımlanmamış!');
} else {
  mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB Veritabanına Başarıyla Bağlanıldı!'))
    .catch(err => console.error('MongoDB BAGLANTI HATASI DETAYI:', err.message));
}

// Mongoose Kullanıcı Şeması
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  balance: { type: Number, default: 1000 },
  level: { type: Number, default: 1 },
  xp: { type: Number, default: 0 },
  isVip: { type: Boolean, default: false }
});

const User = mongoose.model('User', userSchema);

// Bellek İçi Saklama Alanları
const onlineUsers = {};
const activeDuels = {};

// Veritabanı Kayıt Fonksiyonu
async function saveUserData(socketId) {
  const playerData = onlineUsers[socketId];
  if (playerData && playerData.dbId) {
    try {
      await User.findByIdAndUpdate(playerData.dbId, {
        balance: playerData.balance,
        level: playerData.level,
        xp: playerData.xp
      });
      console.log(`Veriler veritabanına kaydedildi: ${playerData.username}`);
    } catch (err) {
      console.error('Veri kaydetme hatası:', err);
    }
  }
}

// Socket.io Bağlantı Yönetimi
io.on('connection', (socket) => {
  console.log('Yeni bağlantı:', socket.id);

  socket.on('userLogin', async (data) => {
    try {
      // Veritabanı bağlantı durumunu doğrula
      if (mongoose.connection.readyState !== 1) {
        console.error('MongoDB bağlantısı henüz kurulmadı!');
        return;
      }

      const username = (data && data.username && data.username.trim())
        ? data.username.trim()
        : `Ziyaretçi_${Math.floor(1000 + Math.random() * 9000)}`;

      // Veritabanında oyuncuyu kontrol et, yoksa oluştur
      let user = await User.findOne({ username });
      if (!user) {
        user = await User.create({ username });
        console.log(`Yeni oyuncu veritabanına eklendi: ${username}`);
      } else {
        console.log(`Kayıtlı oyuncu giriş yaptı: ${username}`);
      }

      // Aktif oyunculara kaydet
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
      console.error('Kullanıcı giriş hatası:', err);
    }
  });

  socket.on('disconnect', async () => {
    await saveUserData(socket.id);
    delete onlineUsers[socket.id];
    console.log('Oyuncu ayrıldı:', socket.id);
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda dinleniyor...`);
});
