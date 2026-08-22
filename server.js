const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/throne_war';
mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB bağlantısı başarılı!'))
  .catch(err => console.error('MongoDB bağlantı hatası:', err));

const userSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    level: { type: Number, default: 1 },
    exp: { type: Number, default: 0 },
    balance: { type: Number, default: 100 },
    rubies: { type: Number, default: 10 },
    str: { type: Number, default: 5 },
    vit: { type: Number, default: 5 },
    statPoints: { type: Number, default: 5 },
    hp: { type: Number, default: 100 },
    seferLimiti: { type: Number, default: 20 },
    seferNextRefill: { type: Number, default: Date.now() },
    estates: { type: [Number], default: [] },
    upgrades: { weapon: { type: Number, default: 0 }, armor: { type: Number, default: 0 }, helmet: { type: Number, default: 0 } },
    equipped: { helmet: Object, necklace: Object, armor: Object, weapon: Object, shield: Object, ring: Object, gloves: Object, boots: Object },
    inventory: { type: Array, default: [] }
});

const User = mongoose.model('User', userSchema);
const users = {};

const getDefaultInventory = () => [
    { id: 'item_1', name: 'Tahta Kılıç', icon: '🗡️', type: 'weapon', strBonus: 3, vitBonus: 0 },
    { id: 'item_2', name: 'Deri Zırh', icon: 'https://i.hizliresim.com/hnneaa5l.jpg', type: 'armor', strBonus: 0, vitBonus: 5 },
    { id: 'item_3', name: 'Bakır Kolye', icon: '📿', type: 'necklace', strBonus: 1, vitBonus: 2 }
];

io.on('connection', (socket) => {
    console.log('Yeni bir gladyatör bağlandı:', socket.id);

    socket.on('userRegister', async (data) => {
        const { username, password } = data;
        if (!username ||!password) {
            return socket.emit('authResult', { success: false, message: "Kullanıcı adı ve şifre boş olamaz!" });
        }
        try {
            if (await User.findOne({ username })) {
                return socket.emit('authResult', { success: false, message: "Bu isimde bir gladyatör zaten var!" });
            }
            const hashedPassword = await bcrypt.hash(password, 10);
            const newUser = new User({ username, password: hashedPassword, inventory: getDefaultInventory() });
            await newUser.save();
            socket.emit('authResult', { success: true, message: "Kayıt başarılı! Şimdi giriş yapabilirsiniz." });
        } catch (err) {
            console.error("Kayıt hatası:", err);
            socket.emit('authResult', { success: false, message: "Sunucu hatası oluştu." });
        }
    });

    socket.on('userLogin', async (data) => {
        const { username, password } = data;
        try {
            const dbUser = await User.findOne({ username });
            if (!dbUser ||!await bcrypt.compare(password, dbUser.password)) {
                return socket.emit('authResult', { success: false, message: "Hatalı giriş!" });
            }
            users[socket.id] = dbUser;
            socket.emit('userData', dbUser.toObject());
        } catch (err) {
            console.error("Giriş hatası:", err);
            socket.emit('authResult', { success: false, message: "Giriş yapılırken bir hata oluştu." });
        }
    });

    socket.on('logout', () => {
        delete users[socket.id];
        socket.disconnect();
    });

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

    socket.on('doQuest', async (data) => {
        const user = users[socket.id];
        if (!user || user.hp <= 0 || user.seferLimiti <= 0) return;

        const q = {1:{g:45,e:20,h:15,n:"Karanlık Orman"},2:{g:120,e:55,h:35,n:"Unutulmuş Tapınak"},3:{g:300,e:140,h:70,n:"Ejderha Dağı"}}[data.questId||1];
        user.seferLimiti -= 1;
        user.hp = Math.max(0, user.hp - q.h);
        user.balance += q.g;
        user.exp += q.e;

        let levelUpMsg = "";
        if (user.exp >= user.level * 100) {
            user.level += 1; user.exp = 0; user.statPoints += 3; user.hp = user.vit * 20;
            levelUpMsg = " SEVİYE ATLADIN!";
        }
        await user.save();
        socket.emit('questResult', { success: true, userData: user.toObject(), message: `${q.n} başarılı!${levelUpMsg}`, goldEarned: q.g, expEarned: q.e, hpLost: q.h });
    });

    socket.on('buyEstate', async (data) => {
        const user = users[socket.id];
        const cost = {1:500,2:2000,3:7500}[data.estateId];
        if (user.balance >= cost &&!user.estates.includes(data.estateId)) {
            user.balance -= cost;
            user.estates.push(data.estateId);
            await user.save();
            socket.emit('marketResult', { userData: user.toObject(), message: "Mülk alındı!" });
        }
    });

    socket.on('upgradeItem', async (data) => {
        const user = users[socket.id];
        const type = data.itemType;
        const cost = (user.upgrades[type] + 1) * 100;
        if (user.balance >= cost) {
            user.balance -= cost;
            user.upgrades[type] += 1;
            user.markModified('upgrades');
            await user.save();
            socket.emit('forgeResult', { userData: user.toObject(), message: `${type} +${user.upgrades[type]} oldu!` });
        }
    });

    socket.on('usePotion', async () => {
        const user = users[socket.id];
        if (user && user.balance >= 50) {
            user.balance -= 50;
            user.hp = user.vit * 20;
            await user.save();
            socket.emit('statUpdated', user.toObject());
        }
    });

    socket.on('equipItem', async (data) => {
        const user = users[socket.id];
        const item = user.inventory[data.itemIndex];
        const old = user.equipped[item.type];
        user.inventory.splice(data.itemIndex, 1);
        if (old) user.inventory.push(old);
        user.equipped[item.type] = item;
        user.markModified('equipped');
        user.markModified('inventory');
        await user.save();
        socket.emit('statUpdated', user.toObject());
    });

    socket.on('unequipItem', async (data) => {
        const user = users[socket.id];
        if (!user.equipped[data.slot]) return;
        user.inventory.push(user.equipped[data.slot]);
        user.equipped[data.slot] = null;
        user.markModified('equipped');
        user.markModified('inventory');
        await user.save();
        socket.emit('statUpdated', user.toObject());
    });

    socket.on('sendChatMessage', (data) => {
        io.emit('receiveChatMessage', { username: users[socket.id]?.username, message: data.message });
    });

    socket.on('disconnect', () => delete users[socket.id]);
});

// PASİF GELİR
setInterval(async () => {
    for (const socketId in users) {
        const user = users[socketId];
        let income = 0;
        if (user.estates.includes(1)) income += 10;
        if (user.estates.includes(2)) income += 45;
        if (user.estates.includes(3)) income += 180;
        if (income > 0) {
            user.balance += income;
            await user.save();
            io.to(socketId).emit('statUpdated', user
