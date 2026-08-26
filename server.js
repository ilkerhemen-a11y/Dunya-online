const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(__dirname + '/public'));

const MAX_SEFER_LIMITI = 20;
const REFILL_INTERVAL = 30 * 60 * 1000;

function checkSeferRefill(user) {
    const now = Date.now();
    if (user.seferLimiti <= 0 && user.seferNextRefill && now >= user.seferNextRefill) {
        user.seferLimiti = MAX_SEFER_LIMITI;
        user.seferNextRefill = null;
        return true;
    }
    return false;
}

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
    statPoints: { type: Number, default: 0 },
    hp: { type: Number, default: 100 },
    seferLimiti: { type: Number, default: 20 },
    seferNextRefill: { type: Number, default: null },
    estates: { type: [Number], default: [] },
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
    { id: 'item_1', name: 'Tahta Kılıç', icon: '🗡️', type: 'weapon', strBonus: 3, vitBonus: 0, level: 0 },
    { id: 'item_2', name: 'Deri Zırh', icon: '🛡️', type: 'armor', strBonus: 0, vitBonus: 5, level: 0 }
];

io.on('connection', (socket) => {
    socket.on('userRegister', async (data) => {
        const { username, password } = data;
        if (!username || !password) return socket.emit('authResult', { success: false, message: "Eksik bilgi!" });
        try {
            const existing = await User.findOne({ username });
            if (existing) return socket.emit('authResult', { success: false, message: "Bu isimde gladyatör var!" });
            const hashedPassword = await bcrypt.hash(password, 10);
            const newUser = new User({ username, password: hashedPassword, inventory: getDefaultInventory() });
            await newUser.save();
            socket.emit('authResult', { success: true, message: "Kayıt başarılı!" });
        } catch (err) { socket.emit('authResult', { success: false, message: "Hata oluştu." }); }
    });

    socket.on('userLogin', async (data) => {
        const { username, password } = data;
        try {
            const dbUser = await User.findOne({ username });
            if (!dbUser || !(await bcrypt.compare(password, dbUser.password))) {
                return socket.emit('authResult', { success: false, message: "Hatalı kullanıcı adı veya şifre!" });
            }
            if (checkSeferRefill(dbUser)) await dbUser.save();
            users[socket.id] = dbUser;
            socket.emit('userData', dbUser);
        } catch (err) { socket.emit('authResult', { success: false, message: "Giriş hatası." }); }
    });

    socket.on('logout', () => { delete users[socket.id]; socket.emit('logoutSuccess'); });

    socket.on('distributeStat', async (statName) => {
        const user = users[socket.id];
        if (user && user.statPoints > 0) {
            if (statName === 'str') user.str += 1;
            if (statName === 'vit') { user.vit += 1; user.hp += 20; }
            user.statPoints -= 1;
            await user.save();
            socket.emit('statUpdated', user);
        }
    });

    socket.on('doQuest', async (data) => {
        const user = users[socket.id];
        if (!user) return;
        checkSeferRefill(user);
        if (user.seferLimiti <= 0) return socket.emit('questResult', { success: false, message: "Sefer hakkınız bitti!" });
        
        user.seferLimiti -= 1;
        if (user.seferLimiti === 0) user.seferNextRefill = Date.now() + REFILL_INTERVAL;

        const quests = { 1: [45, 20, 15], 2: [120, 55, 35], 3: [300, 140, 70] };
        const q = quests[data.questId] || quests[1];

        user.balance += q[0];
        user.exp += q[1];
        user.hp = Math.max(0, user.hp - q[2]);

        const maxExp = user.level * 100;
        if (user.exp >= maxExp) { user.level += 1; user.exp -= maxExp; user.statPoints += 3; user.hp = user.vit * 20; }

        await user.save();
        socket.emit('questResult', { success: true, userData: user, message: "Sefer başarıyla tamamlandı!" });
    });

    socket.on('doDungeon', async (data) => {
        const user = users[socket.id];
        if (!user) return;
        const floors = { 1: [20, 100, 40], 2: [45, 250, 90], 3: [90, 600, 200], 4: [150, 1500, 500] };
        const f = floors[data.floor];
        if (!f || user.hp < f[0]) return socket.emit('dungeonResult', { success: false, message: "Canınız yetersiz!" });

        user.hp -= f[0]; user.balance += f[1]; user.exp += f[2];
        if(data.floor === 4) user.rubies += 2;
        await user.save();
        socket.emit('dungeonResult', { success: true, userData: user, message: "Zindan katı temizlendi!" });
    });

    // PAZAR YERİ: CAN İKSİRİ, SEFER İKSİRİ VE GİZEMLİ SANDIK
    socket.on('usePotion', async () => {
        const user = users[socket.id];
        if (!user || user.balance < 50) return socket.emit('marketResult', { success: false, userData: user, message: "Yetersiz altın!" });
        user.balance -= 50; user.hp = user.vit * 20;
        await user.save();
        socket.emit('marketResult', { success: true, userData: user, message: "Can iksiri içildi, HP doldu!" });
    });

    socket.on('refillSefer', async () => {
        const user = users[socket.id];
        if (!user || user.balance < 50) return socket.emit('marketResult', { success: false, userData: user, message: "Yetersiz altın!" });
        user.balance -= 50; user.seferLimiti = MAX_SEFER_LIMITI; user.seferNextRefill = null;
        await user.save();
        socket.emit('marketResult', { success: true, userData: user, message: "Sefer limitiniz yenilendi!" });
    });

    socket.on('buyMysteryBox', async () => {
        const user = users[socket.id];
        if (!user || user.balance < 300) return socket.emit('marketResult', { success: false, userData: user, message: "Sandık için 300 altın gerekli!" });
        
        user.balance -= 300;
        const randomItems = [
            { id: 'item_sword', name: 'Savaş Baltası', icon: '🪓', type: 'weapon', strBonus: 7, vitBonus: 2, level: 0 },
            { id: 'item_shield', name: 'Demir Kalkan', icon: '🛡', type: 'shield', strBonus: 2, vitBonus: 6, level: 0 },
            { id: 'item_ring', name: 'Kudret Yüzüğü', icon: '💍', type: 'ring', strBonus: 4, vitBonus: 4, level: 0 }
        ];
        const wonItem = randomItems[Math.floor(Math.random() * randomItems.length)];
        user.inventory.push(wonItem);
        user.markModified('inventory');
        await user.save();
        socket.emit('marketResult', { success: true, userData: user, message: `🎁 Sandıktan ${wonItem.name} çıktı ve envantere eklendi!` });
    });

    socket.on('buyEstate', async (data) => {
        const user = users[socket.id];
        if (!user) return;
        const costs = { 1: 500, 2: 2000, 3: 7500 };
        const cost = costs[data.estateId];
        if (user.estates.includes(data.estateId) || user.balance < cost) return socket.emit('marketResult', { success: false, userData: user, message: "İşlem başarısız (Yetersiz altın veya zaten sahipsiniz)." });
        user.balance -= cost; user.estates.push(data.estateId);
        await user.save();
        socket.emit('marketResult', { success: true, userData: user, message: "Tımar başarıyla satın alındı!" });
    });

    socket.on('upgradeItem', async (data) => {
        const user = users[socket.id];
        if (!user || !user.inventory[data.itemIndex]) return;
        const item = user.inventory[data.itemIndex];
        const cost = ((item.level || 0) + 1) * 150;
        if (user.balance < cost) return socket.emit('forgeResult', { success: false, userData: user, message: "Yetersiz altın!" });

        user.balance -= cost;
        item.level = (item.level || 0) + 1;
        item.strBonus = (item.strBonus || 0) + 2;
        item.vitBonus = (item.vitBonus || 0) + 2;
        user.markModified('inventory');
        await user.save();
        socket.emit('forgeResult', { success: true, userData: user, message: `Eşya +${item.level} seviyesine geliştirildi!` });
    });

    socket.on('equipItem', async (data) => {
        const user = users[socket.id];
        if (!user || !user.inventory[data.itemIndex]) return;
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

    socket.on('deleteItem', async (data) => {
        const user = users[socket.id];
        if (!user || data.itemIndex === undefined) return;
        user.inventory.splice(data.itemIndex, 1);
        user.markModified('inventory');
        await user.save();
        socket.emit('statUpdated', user);
    });

    socket.on('sendChatMessage', (data) => {
        io.emit('receiveChatMessage', { username: users[socket.id]?.username, message: data.message });
    });

    socket.on('disconnect', () => delete users[socket.id]);
});

setInterval(async () => {
    for (const id in users) {
        const u = users[id];
        let inc = 0;
        if (u.estates.includes(1)) inc += 10;
        if (u.estates.includes(2)) inc += 45;
        if (u.estates.includes(3)) inc += 180;
        if (inc > 0) {
            u.balance += inc;
            await User.updateOne({ _id: u._id }, { $set: { balance: u.balance } });
            io.to(id).emit('statUpdated', u);
        }
    }
}, 60000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Sunucu aktif: ${PORT}`));
