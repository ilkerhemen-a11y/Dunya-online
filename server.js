const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Mongoose Model: Meslek ve Görevleri destekleyen yapı
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  balance: { type: Number, default: 1000 },
  job: { type: String, default: 'Çiftçi' },
  energy: { type: Number, default: 100 },
  hunger: { type: Number, default: 85 },
  prestige: { type: Number, default: 0 }, // Şeref
  inventory: { type: Array, default: ['Paslı Çapa'] },
  completedQuests: { type: Array, default: [] }
});

const User = mongoose.model('User', userSchema);

// Oyun Verileri
const jobs = {
  'Çiftçi': { income: 50, energyCost: 10 },
  'Demirci': { income: 200, energyCost: 20 },
  'Muhafız': { income: 150, energyCost: 15 },
  // ... diğerleri eklenebilir
};

io.on('connection', (socket) => {
  socket.on('userLogin', async (data) => {
    let user = await User.findOne({ username: data.username });
    if (!user) user = await User.create({ username: data.username });
    socket.emit('userData', user);
  });

  // Meslek Değiştirme
  socket.on('changeJob', async (data) => {
    const user = await User.findOne({ username: data.username });
    if (user.balance >= 5000) {
      user.balance -= 5000;
      user.job = data.newJob;
      await user.save();
      socket.emit('userData', user);
      socket.emit('gameLog', `👑 Yeni unvanın: ${data.newJob}`);
    } else {
      socket.emit('gameLog', '❌ Meslek değiştirmek için 5000 Altın gerekir!');
    }
  });

  // Zanaat (Vardiya yerine)
  socket.on('performCraft', async (data) => {
    const user = await User.findOne({ username: data.username });
    const jobInfo = jobs[user.job] || { income: 30, energyCost: 10 };
    
    if (user.energy >= jobInfo.energyCost) {
      user.energy -= jobInfo.energyCost;
      user.balance += jobInfo.income;
      await user.save();
      socket.emit('userData', user);
      socket.emit('gameLog', `⚒️ ${user.job} olarak çalıştın. +${jobInfo.income} Altın.`);
    } else {
      socket.emit('gameLog', '⚡ Dayanıklılığın yetersiz!');
    }
  });

  // Görev Tamamlama (Örnek: İlk Görev)
  socket.on('completeQuest', async (data) => {
    const user = await User.findOne({ username: data.username });
    if (!user.completedQuests.includes(data.questId)) {
        user.balance += data.reward;
        user.completedQuests.push(data.questId);
        await user.save();
        socket.emit('userData', user);
        socket.emit('gameLog', `✨ Görev Tamamlandı: ${data.questName}`);
    }
  });
});

server.listen(10000, () => console.log('TAHT SAVAŞI 10000 portunda başladı.'));
