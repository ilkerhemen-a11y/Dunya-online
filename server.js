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
  workCooldownUntil: { type: Number, default: 0 },
  loanDebt: { type: Number, default: 0 },
  loanInstallment: { type: Number, default: 0 },
  nextLoanPaymentDue: { type: Number, default: 0 },
  expenses: {
    rent: { type: Number, default: 500 },
    bills: { type: Number, default: 300 },
  }
});

const User = mongoose.model('User', userSchema);
const onlineUsers = {};

// Online kullanıcı listesini herkese gönderen yardımcı fonksiyon
function broadcastOnlineList() {
  const list = Object.values(onlineUsers).map(u => ({
    username: u.username,
    home: u.home,
    car: u.car
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
        home: playerData.home,
        car: playerData.car,
        stocks: playerData.stocks,
        workCooldownUntil: playerData.workCooldownUntil,
        loanDebt: playerData.loanDebt,
        loanInstallment: playerData.loanInstallment,
        nextLoanPaymentDue: playerData.nextLoanPaymentDue,
        expenses: playerData.expenses
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

      // Aynı isimde kullanıcı varsa çakışmayı önle
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
          home: "Stüdyo Daire",
          car: "Yok",
          stocks: 0,
          workCooldownUntil: 0,
          loanDebt: 0,
          loanInstallment: 0,
          nextLoanPaymentDue: 0,
          expenses: { rent: 500, bills: 300 }
        };
        socket.emit('userData', onlineUsers[socket.id]);
        broadcastOnlineList();
        io.emit('chatMessage', { sender: 'Sistem', text: `${username} şehre adım attı!` });
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
        loanDebt: user.loanDebt || 0,
        loanInstallment: user.loanInstallment || 0,
        nextLoanPaymentDue: user.nextLoanPaymentDue || 0,
        expenses: user.expenses || { rent: 500, bills: 300 }
      };

      socket.emit('userData', onlineUsers[socket.id]);
      broadcastOnlineList();
      io.emit('chatMessage', { sender: 'Sistem', text: `${username} şehre giriş yaptı.` });
    } catch (err) {
      console.error('Giriş Hatası:', err.message);
    }
  });

  // Sohbet Mesajı Dinleyicisi
  socket.on('sendChat', (text) => {
    const player = onlineUsers[socket.id];
    if (!player || !text || text.trim() === '') return;
    const cleanText = text.trim().substring(0, 250); // Maksimum 250 karakter
    io.emit('chatMessage', { sender: player.username, text: cleanText });
  });

  // Çalışma (Vardiya) - 24dk ölçeğinde 8 dakika bekleme süresi (8 * 60 * 1000 ms)
  socket.on('workShift', async () => {
    const player = onlineUsers[socket.id];
    if (!player) return;

    const now = Date.now();

    // Kredi taksit kontrolü
    if (player.loanDebt > 0 && now >= player.nextLoanPaymentDue) {
      if (player.balance >= player.loanInstallment) {
        player.balance -= player.loanInstallment;
        player.loanDebt = Math.max(0, player.loanDebt - player.loanInstallment);
        player.nextLoanPaymentDue = now + (3 * 60 * 1000); // 3 dakikada bir taksit döngüsü
        socket.emit('gameLog', `💳 Kredi taksiti (${player.loanInstallment} ₺) hesaptan otomatik çekildi! Kalan borç: ${player.loanDebt} ₺`);
      } else {
        socket.emit('gameLog', `⚠️ Bakiye yetersiz! Kredi taksiti ödenemedi.`);
      }
    }

    if (now < player.workCooldownUntil) {
      const remainingSeconds = Math.ceil((player.workCooldownUntil - now) / 1000);
      const minutes = Math.floor(remainingSeconds / 60);
      const seconds = remainingSeconds % 60;
      socket.emit('gameLog', `⏳ Henüz dinleniyorsun! Çalışmak için ${minutes}d ${seconds}s beklemelisin.`);
      return;
    }

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
    player.workCooldownUntil = Date.now() + (8 * 60 * 1000); // 8 Dakika Vardiya Bekleme Süresi

    socket.emit('userData', player);
    socket.emit('gameLog', 'Vardiya tamamlandı! +2.840 ₺ kazandın. Yeni vardiya için 8 dakika süre başladı.');
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

  const loanTypes = {
    'home': { cost: 15000, name: 'Lüks Rezidans', installment: 2500 },
    'car': { cost: 10000, name: 'Spor Otomobil', installment: 1800 }
  };

  socket.on('takeLoanAndBuy', async (type) => {
    const player = onlineUsers[socket.id];
    if (!player) return;
    
    const target = loanTypes[type];
    if (!target) return;

    if (player.loanDebt > 0) {
      socket.emit('gameLog', '❌ Zaten aktif bir kredi borcun var! Yeni kredi çekemezsin.');
      return;
    }

    player.balance += target.cost;
    player.loanDebt = target.cost * 1.3;
    player.loanInstallment = target.installment;
    player.nextLoanPaymentDue = Date.now() + (3 * 60 * 1000); // 3 dakika sonra ilk taksit

    if (type === 'home') {
      player.home = target.name;
      player.expenses.rent += 800;
    } else if (type === 'car') {
      player.car = target.name;
    }

    player.cityRank = Math.max(1, player.cityRank - 300);
    socket.emit('userData', player);
    broadcastOnlineList();
    socket.emit('gameLog', `🏦 Kredi onaylandı! ${target.name} alındı. Borç: ${player.loanDebt} ₺`);
  });

  socket.on('buyTimeSkip', async () => {
    const player = onlineUsers[socket.id];
    if (!player) return;
    if (player.balance < 1000) {
      socket.emit('gameLog', 'Zamanı hızlandırmak için 1.000 ₺ gerekiyor.');
      return;
    }
    player.balance -= 1000;
    player.workCooldownUntil = 0;
    player.hunger = Math.min(100, player.hunger + 30);
    player.energy = 100;
    player.fun = 100;
    socket.emit('userData', player);
    socket.emit('gameLog', '⚡ Zaman atlandı! Bekleme süreleri sıfırlandı ve ihtiyaçlar doldu.');
  });

  socket.on('disconnect', async () => {
    await saveUserData(socket.id);
    const playerName = onlineUsers[socket.id]?.username;
    delete onlineUsers[socket.id];
    broadcastOnlineList();
    if (playerName) {
      io.emit('chatMessage', { sender: 'Sistem', text: `${playerName} şehirden ayrıldı.` });
    }
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});
