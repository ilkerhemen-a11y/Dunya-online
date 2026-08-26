const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Statik dosyaları sunma (HTML, CSS vb. için public veya ana dizin)
app.use(express.static(__dirname));

// MongoDB Bağlantısı (Render ortamı için MONGO_URI öncelikli, yerel için fallback)
const dbURI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/taht-savasi";

mongoose.connect(dbURI)
  .then(() => console.log("MongoDB Bağlantısı Başarılı!"))
  .catch(err => console.error("DB Bağlantı Hatası:", err));

// Kullanıcı Şeması
const userSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    level: { type: Number, default: 1 },
    exp: { type: Number, default: 0 },
    balance: { type: Number, default: 200 },
    rubies: { type: Number, default: 10 },
    hp: { type: Number, default: 100 },
    str: { type: Number, default: 5 },
    vit: { type: Number, default: 5 },
    statPoints: { type: Number, default: 0 },
    seferLimiti: { type: Number, default: 20 },
    estates: { type: Array, default: [] },
    equipped: {
        helmet: { type: Object, default: null },
        necklace: { type: Object, default: null },
        armor: { type: Object, default: null },
        weapon: { type: Object, default: null },
        shield: { type: Object, default: null },
        ring: { type: Object, default: null },
        gloves: { type: Object, default: null },
        boots: { type: Object, default: null }
    },
    inventory: { type: Array, default: [
        { name: "Paslı Kılıç", icon: "🗡️", strBonus: 2, vitBonus: 0, level: 0 },
        { name: "Deri Zırh", icon: "🛡️", strBonus: 1, vitBonus: 3, level: 0 }
    ]}
});

const User = mongoose.model('User', userSchema);

// Socket.io Bağlantı Yönetimi
io.on('connection', (socket) => {
    console.log(`Bir gezgin bağlandı: ${socket.id}`);
    let loggedInUser = null;

    // Kayıt Olma
    socket.on('userRegister', async (data) => {
        try {
            const existing = await User.findOne({ username: data.username });
            if (existing) {
                return socket.emit('authResult', { success: false, message: 'Bu gladyatör adı zaten alınmış!' });
            }
            const newUser = new User({
                username: data.username,
                password: data.password
            });
            await newUser.save();
            socket.emit('authResult', { success: true, message: 'Kayıt başarılı! Şimdi giriş yapabilirsiniz.' });
        } catch (err) {
            socket.emit('authResult', { success: false, message: 'Kayıt sırasında bir hata oluştu.' });
        }
    });

    // Giriş Yapma
    socket.on('userLogin', async (data) => {
        try {
            const user = await User.findOne({ username: data.username, password: data.password });
            if (!user) {
                return socket.emit('authResult', { success: false, message: 'Hatalı kullanıcı adı veya şifre!' });
            }
            loggedInUser = user;
            socket.emit('authResult', { success: true, message: 'Giriş başarılı!' });
            socket.emit('userData', user);
        } catch (err) {
            socket.emit('authResult', { success: false, message: 'Giriş yapılırken bir hata oluştu.' });
        }
    });

    // Stat Dağıtma
    socket.on('distributeStat', async (statType) => {
        if (!loggedInUser) return;
        const user = await User.findById(loggedInUser._id);
        if (user.statPoints > 0) {
            user.statPoints -= 1;
            if (statType === 'str') user.str += 1;
            if (statType === 'vit') {
                user.vit += 1;
                user.hp = user.vit * 20; // Canı güncelle
            }
            await user.save();
            loggedInUser = user;
            socket.emit('userData', user);
        }
    });

    // Sefer Görevi Yapma
    socket.on('doQuest', async (data) => {
        if (!loggedInUser) return;
        let user = await User.findById(loggedInUser._id);
        
        const quests = {
            1: { gold: 45, exp: 20, damage: 15 },
            2: { gold: 120, exp: 55, damage: 35 },
            3: { gold: 300, exp: 140, damage: 70 }
        };

        const quest = quests[data.questId];
        if (!quest) return;

        if (user.hp < quest.damage) {
            return socket.emit('questResult', { success: false, message: 'Canınız bu sefer için çok az! İksir içmelisiniz.' });
        }

        user.hp -= quest.damage;
        user.balance += quest.gold;
        user.exp += quest.exp;

        // Seviye Atlama Kontrolü
        const maxExp = user.level * 100;
        if (user.exp >= maxExp) {
            user.exp -= maxExp;
            user.level += 1;
            user.statPoints += 3;
            user.hp = user.vit * 20;
        }

        await user.save();
        loggedInUser = user;
        socket.emit('questResult', { success: true, message: `Sefer başarıyla tamamlandı! +${quest.gold} Altın, +${quest.exp} Tecrübe kazandınız.`, userData: user });
    });

    // Sohbet Mesajı
    socket.on('sendChatMessage', (data) => {
        if (!loggedInUser) return;
        io.emit('receiveChatMessage', { username: loggedInUser.username, message: data.message });
    });

    // Çıkış Yapma
    socket.on('logout', () => {
        loggedInUser = null;
        socket.emit('logoutSuccess');
    });

    socket.on('disconnect', () => {
        console.log('Bir gezgin ayrıldı.');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor...`);
});
