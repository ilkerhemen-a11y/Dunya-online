const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

app.use(express.static(__dirname + '/public'));

// 1. MongoDB Bağlantısı
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/throne_war';

mongoose.connect(MONGO_URI)
.then(() => {
    console.log('MongoDB bağlantısı başarılı!');
}).catch(err => {
    console.error('MongoDB bağlantı hatası:', err);
});

// 2. Kullanıcı Veritabanı Şeması
const userSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    level: { type: Number, default: 1 },
    exp: { type: Number, default: 0 },
    balance: { type: Number, default: 100 },
    rubies: { type: Number, default: 10 },
    str: { type: Number, default: 5 },
    vit: { type: Number, default: 5 },
    statPoints: { type: Number, default: 0 },
    hp: { type: Number, default: 100 },
    seferLimiti: { type: Number, default: 20 },
    seferNextRefill: { type: Number, default: null },
    upgrades: {
        weapon: { type: Number, default: 0 },
        armor: { type: Number, default: 0 },
        helmet: { type: Number, default: 0 }
    },
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
const users = {}; 

const getDefaultInventory = () => [
    { id: 'item_1', name: 'Tahta Kılıç', icon: '🗡️', type: 'weapon', strBonus: 3, vitBonus: 0 },
    { id: 'item_2', name: 'Deri Zırh', icon: 'https://i.hizliresim.com/hnneaa5l.jpg', type: 'armor', strBonus: 0, vitBonus: 5, isImage: true },
    { id: 'item_3', name: 'Bakır Kolye', icon: '📿', type: 'necklace', strBonus: 1, vitBonus: 2 },
    { id: 'item_4', name: 'Çelik Kask', icon: 'https://i.hizliresim.com/twgkfi5q.jpg', type: 'helmet', strBonus: 1, vitBonus: 3, isImage: true },
    { id: 'item_5', name: 'Tahta Kalkan', icon: '🪵', type: 'shield', strBonus: 0, vitBonus: 4 },
    { id: 'item_6', name: 'Bronz Yüzük', icon: '💍', type: 'ring', strBonus: 2, vitBonus: 1 },
    { id: 'item_7', name: 'Kumaş Eldiven', icon: '🧤', type: 'gloves', strBonus: 1, vitBonus: 1 },
    { id: 'item_8', name: 'Eski Çizme', icon: '🥾', type: 'boots', strBonus: 0, vitBonus: 2 }
];

io.on('connection', (socket) => {
    console.log('Yeni bir gladyatör bağlandı:', socket.id);

    // Giriş Yapma
    socket.on('userLogin', async (data) => {
        const username = data.username ? data.username.trim() : 'Gladyatör';
        try {
            let dbUser = await User.findOne({ username });
            if (!dbUser) {
                dbUser = new User({ username: username, inventory: getDefaultInventory() });
                await dbUser.save();
            } else if (!dbUser.inventory || dbUser.inventory.length === 0) {
                dbUser.inventory = getDefaultInventory();
                await dbUser.save();
            }
            users[socket.id] = dbUser;
            socket.emit('userData', dbUser);
        } catch (err) { console.error("Giriş hatası:", err); }
    });

    // Çıkış Yapma
    socket.on('logout', async () => {
        if (users[socket.id]) {
            console.log('Gladyatör çıkış yaptı:', users[socket.id].username);
            delete users[socket.id];
            socket.emit('logoutSuccess');
            socket.disconnect();
        }
    });

    // Eşya İşlemleri
    socket.on('equipItem', async (data) => {
        const user = users[socket.id];
        if (!user) return;
        const item = user.inventory[data.itemIndex];
        const old = user.equipped[item.type];
        user.inventory.splice(data.itemIndex, 1);
        if (old) user.inventory.push(old);
        user.equipped[item.type] = item;
        user.markModified('equipped'); user.markModified('inventory');
        await user.save();
        socket.emit('statUpdated', user);
    });

    socket.on('unequipItem', async (data) => {
        const user = users[socket.id];
        if (!user || !user.equipped[data.slot]) return;
        user.inventory.push(user.equipped[data.slot]);
        user.equipped[data.slot] = null;
        user.markModified('equipped'); user.markModified('inventory');
        await user.save();
        socket.emit('statUpdated', user);
    });

    // Sefer ve Diğer İşlemler
    socket.on('doQuest', async (data) => {
        const user = users[socket.id];
        if (!user) return;
        if (user.hp <= 0 || user.seferLimiti <= 0) return socket.emit('questResult', { success: false, message: "Can veya Sefer hakkı yetersiz!" });
        
        user.seferLimiti -= 1;
        user.hp = Math.max(0, user.hp - Math.floor(Math.random() * 10 + 5));
        user.balance += 50;
        await user.save();
        socket.emit('questResult', { success: true, userData: user });
    });

    socket.on('usePotion', async () => {
        const user = users[socket.id];
        if (user && user.balance >= 50) {
            user.balance -= 50; user.hp = user.vit * 20;
            await user.save();
            socket.emit('questResult', { success: true, userData: user });
        }
    });

    socket.on('sendChatMessage', (data) => {
        io.emit('receiveChatMessage', { username: users[socket.id]?.username, message: data.message });
    });

    socket.on('disconnect', () => delete users[socket.id]);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Sunucu http://localhost:${PORT} aktif.`));
