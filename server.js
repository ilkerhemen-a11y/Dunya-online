const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Statik dosyalar
app.use(express.static(path.join(__dirname, 'public')));

// 1. MongoDB Bağlantısı
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/throne_war';
mongoose.connect(MONGO_URI)
   .then(() => console.log('MongoDB bağlantısı başarılı!'))
   .catch(err => console.error('MongoDB bağlantı hatası:', err));

// 2. Kullanıcı Veritabanı Şeması
const userSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    level: { type: Number, default: 1 },
    exp: { type: Number, default: 0 },
    balance: { type: Number, default: 100 },
    rubies: { type: Number, default: 10 },
    str: { type: Number, default: 5 },
    vit: { type: Number, default: 5 },
    statPoints: { type: Number, default: 5 }, // Başlangıçta 5 puan verdim
    hp: { type: Number, default: 100 },
    seferLimiti: { type: Number, default: 20 },
    seferNextRefill: { type: Number, default: Date.now() },
    estates: { type: [Number], default: [] },
    upgrades: { weapon: { type: Number, default: 0 }, armor: { type: Number, default: 0 }, helmet: { type: Number, default: 0 } },
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
    inventory: { type: Array, default: [] }
});

const User = mongoose.model('User', userSchema);
const users = {}; // Aktif kullanıcılar bellekte

const getDefaultInventory = () => [
    { id: 'item_1', name: 'Tahta Kılıç', icon: '🗡️', type: 'weapon', strBonus: 3, vitBonus: 0 },
    { id: 'item_2', name: 'Deri Zırh', icon: 'https://i.hizliresim.com/hnneaa5l.jpg', type: 'armor', strBonus: 0, vitBonus: 5 },
    { id: 'item_3', name: 'Bakır Kolye', icon: '📿', type: 'necklace', strBonus: 1, vitBonus: 2 }
];

io.on('connection', (socket) => {
    console.log('Yeni bir gladyatör bağlandı:', socket.id);

    // Kayıt Olma İşlemi
    socket.on('userRegister', async (data) => {
        const { username, password } = data;
        if (!username ||!password || username.trim() === '' || password.trim() === '') {
            return socket.emit('authResult', { success: false, message: "Kullanıcı adı ve şifre boş olamaz!" });
        }

        try {
            const existingUser = await User.findOne({ username });
            if (existingUser) {
                return socket.emit('authResult', { success: false, message: "Bu isimde bir gladyatör zaten var!" });
            }

            const hashedPassword = await bcrypt.hash(password, 10);
            const newUser = new User({
                username: username,
                password: hashedPassword,
                inventory: getDefaultInventory(),
                seferNextRefill: Date.now() + 180000
            });
            await newUser.save();

            socket.emit('authResult', { success: true, message: "Kayıt başarılı! Şimdi giriş yapabilirsiniz." });
        } catch (err) {
            console.error("Kayıt hatası:", err);
            socket.emit('authResult', { success: false, message: "Sunucu hatası oluştu." });
        }
    });

    // Giriş Yapma İşlemi
    socket.on('userLogin', async (data) => {
        const { username, password } = data;
        try {
            const dbUser = await User.findOne({ username });
            if (!dbUser) {
                return socket.emit('authResult', { success: false, message: "Böyle bir kullanıcı bulunamadı." });
            }

            const isPasswordValid = await bcrypt.compare(password, dbUser.password);
            if (!isPasswordValid) {
                return socket.emit('authResult', { success: false, message: "Hatalı şifre!" });
            }

            users[socket.id] = dbUser;
            socket.emit('userData', dbUser.toObject()); // toObject önemli
        } catch (err) {
            console.error("Giriş hatası:", err);
            socket.emit('authResult', { success: false, message: "Giriş yapılırken bir hata oluştu." });
        }
    });

    // Çıkış Yapma
    socket.on('logout', () => {
        if (users[socket.id]) {
            console.log('Gladyatör çıkış yaptı:', users[socket.id].username);
            delete users[socket.id];
            socket.emit('logoutSuccess');
            socket.disconnect();
        }
    });

    // Stat Puanı Dağıtımı
    socket.on('distributeStat', async (statName) => {
        const user = users[socket.id];
        if (user && user.statPoints > 0) {
            if (statName === 'str') user.str += 1;
            if (statName === 'vit') { user.vit += 1; user.hp += 20; }
            user.statPoints -= 1;
            await user.save();
            socket.emit('statUpdated', user.toObject());
        }
    });

    // Görev (Sefer) Sistemi
    socket.on('doQuest', async (data) => {
        const user = users[socket.id];
        if (!user || user.hp <= 0 || user.seferLimiti <= 0)
            return socket.emit('questResult', { success: false, message: "Can veya Sefer hakkı yetersiz!", userData: user.toObject() });

        const quests = {
            1: { gold: 45, exp: 20, hpLoss: 15, name: "Karanlık Orman" },
            2: { gold: 120, exp: 55, hpLoss: 35, name: "Unutulmuş Tapınak" },
            3: { gold: 300, exp: 140, hpLoss: 70, name: "Ejderha Dağı" }
        };
        const q = quests[data.questId || 1];

        user.seferLimiti -= 1;
        user.seferNextRefill = Date.now() + 180000; // 3 dk sonra 1 tane dolar
        user.hp = Math.max(0, user.hp - q.hpLoss);
        user.balance += q.gold;
        user.exp += q.exp;

        let maxExp = user.level * 100;
        let levelUpMsg = "";
        if (user.exp >= maxExp) {
            user.level += 1;
            user.exp -= maxExp;
            user.statPoints += 3;
            user.hp = user.vit * 20;
            levelUpMsg = " SEVİYE ATLADIN!";
        }

        user.markModified('seferLimiti');
        user.markModified('hp');
        user.markModified('balance');
        user.markModified('exp');
        await user.save();

        socket.emit('questResult', {
            success: true, userData: user.toObject(),
            message: `${q.name} seferi başarılı!${levelUpMsg}`,
            goldEarned: q.gold, expEarned: q.exp, hpLost: q.hpLoss
        });
    });

    // Tımar Satın Alma
    socket.on('buyEstate', async (data) => {
        const user = users[socket.id];
        if (!user) return;

        const estateCost = { 1: 500, 2: 2000, 3: 7500 };
        const cost = estateCost[data.estateId];

        if (user.estates.includes(data.estateId))
            return socket.emit('marketResult', { userData: user.toObject(), message: "Bu mülke zaten sahipsiniz!" });
        if (user.balance < cost)
            return socket.emit('marketResult', { userData: user.toObject(), message: "Yeterli altınınız yok!" });

        user.balance -= cost;
        user.estates.push(data.estateId);
        await user.save();
        socket.emit('marketResult', { userData: user.toObject(), message: "Mülk başarıyla satın alındı! Artık pasif gelir getirecek." });
    });

    // Demirci (+ Basma)
    socket.on('upgradeItem', async (data) => {
        const user = users[socket.id];
        if (!user) return;

        const type = data.itemType;
        if (user.upgrades[type]!== undefined) {
            const cost = (user.upgrades[type] + 1) * 100;
            if (user.balance >= cost) {
                user.balance -= cost;
                user.upgrades[type] += 1;
                user.markModified('upgrades');
                await user.save();
                socket.emit('forgeResult', { userData: user.toObject(), itemType: type, newLevel: user.upgrades[type], message: `${type.toUpperCase()} başarıyla +${user.upgrades[type]} seviyesine yükseltildi!` });
            } else {
                socket.emit('forgeResult', { userData: user.toObject(), itemType: type, newLevel: user.upgrades[type], message: "Geliştirme için yeterli altınınız yok!" });
            }
        }
    });

    // Can İksiri
    socket.on('usePotion', async () => {
        const user = users[socket.id];
        if (user && user.balance >= 50
