const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

mongoose.connect('mongodb://localhost:27017/gladyatorDB', {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log('MongoDB Bağlantısı Başarılı')).catch(err => console.log(err));

// Kullanıcı Şeması (Günlük sefer limiti ve eski envanter yapısıyla)
const userSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    balance: { type: Number, default: 100 },
    rubies: { type: Number, default: 10 },
    level: { type: Number, default: 1 },
    exp: { type: Number, default: 0 },
    hp: { type: Number, default: 100 },
    str: { type: Number, default: 10 },
    vit: { type: Number, default: 5 },
    statPoints: { type: Number, default: 0 },
    seferLimiti: { type: Number, default: 30 }, // 30 Sefer Sınırı
    taktikPuani: { type: Number, default: 0 },
    skills: {
        kritik: { type: Number, default: 0 },
        vampir: { type: Number, default: 0 },
        bereket: { type: Number, default: 0 }
    },
    upgrades: {
        weapon: { type: Number, default: 0 },
        armor: { type: Number, default: 0 },
        helmet: { type: Number, default: 0 }
    },
    estates: { type: Array, default: [] },
    inventory: { type: Array, default: [] }, // Eski Envanter Dizisi
    equipped: {
        helmet: { type: Object, default: null },
        necklace: { type: Object, default: null },
        armor: { type: Object, default: null },
        weapon: { type: Object, default: null }
    }
});

const User = mongoose.model('User', userSchema);

// Pasif Gelir Sistemi
setInterval(async () => {
    try {
        const users = await User.find({});
        for (let user of users) {
            let passiveIncome = 0;
            if (user.estates.includes(1)) passiveIncome += 10;
            if (user.estates.includes(2)) passiveIncome += 45;
            if (user.estates.includes(3)) passiveIncome += 180;

            if (passiveIncome > 0) {
                user.balance += passiveIncome;
                await user.save();
            }
        }
    } catch (err) {
        console.error("Pasif gelir hatası:", err);
    }
}, 60000);

io.on('connection', (socket) => {
    let currentUserId = null;

    socket.on('userRegister', async ({ username, password }) => {
        try {
            const existing = await User.findOne({ username });
            if (existing) return socket.emit('authResult', { success: false, message: 'Bu gladyatör adı zaten alınmış!' });

            const newUser = new User({ username, password, hp: 100 });
            await newUser.save();
            socket.emit('authResult', { success: true, message: 'Kayıt başarılı! Giriş yapabilirsiniz.' });
        } catch (err) {
            socket.emit('authResult', { success: false, message: 'Kayıt sırasında bir hata oluştu.' });
        }
    });

    socket.on('userLogin', async ({ username, password }) => {
        try {
            const user = await User.findOne({ username, password });
            if (!user) return socket.emit('authResult', { success: false, message: 'Hatalı kullanıcı adı veya şifre!' });

            currentUserId = user._id;
            socket.userId = user._id;
            socket.emit('authResult', { success: true, message: 'Giriş başarılı!' });
            socket.emit('userData', user);
        } catch (err) {
            socket.emit('authResult', { success: false, message: 'Giriş yapılamadı.' });
        }
    });

    socket.on('distributeStat', async (stat) => {
        try {
            const user = await User.findById(socket.userId);
            if (!user || user.statPoints <= 0) return;

            if (stat === 'str') {
                user.str += 1;
                user.statPoints -= 1;
            } else if (stat === 'vit') {
                user.vit += 1;
                user.statPoints -= 1;
                user.hp = user.vit * 20;
            }
            await user.save();
            socket.emit('userData', user);
        } catch (err) { console.error(err); }
    });

    socket.on('usePotion', async () => {
        try {
            const user = await User.findById(socket.userId);
            if (!user) return;
            const maxHp = user.vit * 20;
            if (user.balance < 50) return socket.emit('questResult', { message: "Yetersiz altın!" });
            if (user.hp >= maxHp) return socket.emit('questResult', { message: "Canınız zaten tamamen dolu!" });

            user.balance -= 50;
            user.hp = maxHp;
            await user.save();
            socket.emit('userData', user);
        } catch (err) { console.error(err); }
    });

    // Görev / Sefer Sistemi (30 Sefer Sınırı Dahil)
    socket.on('doQuest', async ({ questId }) => {
        try {
            const user = await User.findById(socket.userId);
            if (!user) return;

            if (user.seferLimiti <= 0) {
                return socket.emit('questResult', { message: "Günlük sefer limitiniz doldu!", userData: user });
            }

            let quests = {
                1: { name: "Karanlık Orman", gold: 45, exp: 20, damage: 15 },
                2: { name: "Unutulmuş Tapınak", gold: 120, exp: 55, damage: 35 },
                3: { name: "Ejderha Dağı", gold: 300, exp: 140, damage: 70 }
            };

            let q = quests[questId];
            if (!q) return;

            let maxHp = user.vit * 20;
            if (user.hp <= q.damage) {
                return socket.emit('questResult', { message: "Canınız çok az! İksir içerek canınızı yenileyin.", userData: user });
            }

            user.hp -= q.damage;
            user.seferLimiti -= 1; // Sefer yapıldıkça 1 azalır

            let bonusGoldMultiplier = 1 + (user.skills.bereket * 0.03);
            let finalGold = Math.floor(q.gold * bonusGoldMultiplier);

            user.balance += finalGold;
            user.exp += q.exp;

            let gainedTactical = 0;
            if (Math.random() < 0.30) {
                gainedTactical = 1;
                user.taktikPuani += 1;
            }

            let maxExp = user.level * 100;
            let leveledUp = false;
            if (user.exp >= maxExp) {
                user.exp -= maxExp;
                user.level += 1;
                user.statPoints += 3;
                user.taktikPuani += 2;
                user.hp = maxHp;
                leveledUp = true;
            }

            await user.save();

            let msg = `Sefere çıkıldı: ${q.name}. Kazanılan: 🪙 ${finalGold} Altın, ✨ ${q.exp} EXP. ${gainedTactical > 0 ? '🧠 1 Taktik Puanı!' : ''}`;
            if (leveledUp) msg += ` 🎉 Seviye ${user.level} oldunuz! Canınız yenilendi.`;

            socket.emit('questResult', { message: msg, userData: user });
        } catch (err) { console.error(err); }
    });

    socket.on('upgradeSkill', async ({ skillName }) => {
        try {
            const user = await User.findById(socket.userId);
            if (!user) return;

            if (user.taktikPuani <= 0) {
                return socket.emit('skillResult', { message: "Yetersiz Taktik Puanı!", userData: user });
            }

            if (user.skills[skillName] !== undefined) {
                user.taktikPuani -= 1;
                user.skills[skillName] += 1;
                await user.save();
                socket.emit('skillResult', { message: "Yetenek başarıyla geliştirildi!", userData: user });
            }
        } catch (err) { console.error(err); }
    });

    // Envanter / Ekipman Kuşanma Fonksiyonu (Eski Sistem)
    socket.on('equipItem', async ({ itemIndex }) => {
        try {
            const user = await User.findById(socket.userId);
            if (!user || !user.inventory[itemIndex]) return;

            let item = user.inventory[itemIndex];
            let type = item.type; // helmet, armor, weapon, necklace

            let oldEquipped = user.equipped[type];
            user.equipped[type] = item;

            if (oldEquipped) {
                user.inventory[itemIndex] = oldEquipped;
            } else {
                user.inventory.splice(itemIndex, 1);
            }

            await user.save();
            socket.emit('userData', user);
        } catch (err) { console.error(err); }
    });

    socket.on('buyEstate', async ({ estateId }) => {
        try {
            const user = await User.findById(socket.userId);
            if (!user) return;
            if (user.estates.includes(estateId)) return socket.emit('marketResult', { message: "Bu mülke zaten sahipsiniz." });

            let costs = { 1: 500, 2: 2000, 3: 7500 };
            let cost = costs[estateId];
            if (user.balance < cost) return socket.emit('marketResult', { message: "Yetersiz altın!" });

            user.balance -= cost;
            user.estates.push(estateId);
            await user.save();
            socket.emit('marketResult', { message: "Mülk başarıyla satın alındı!", userData: user });
        } catch (err) { console.error(err); }
    });

    socket.on('upgradeItem', async ({ itemType }) => {
        try {
            const user = await User.findById(socket.userId);
            if (!user) return;
            let currentLevel = user.upgrades[itemType] || 0;
            let cost = (currentLevel + 1) * 100;

            if (user.balance < cost) return socket.emit('forgeResult', { message: "Yetersiz altın!" });

            user.balance -= cost;
            user.upgrades[itemType] += 1;
            await user.save();
            socket.emit('forgeResult', { message: "Ekipman başarıyla geliştirildi!", userData: user });
        } catch (err) { console.error(err); }
    });

    socket.on('sendChatMessage', async ({ message }) => {
        try {
            const user = await User.findById(socket.userId);
            if (!user) return;
            io.emit('receiveChatMessage', { username: user.username, message });
        } catch (err) { console.error(err); }
    });

    socket.on('logout', () => {
        currentUserId = null;
        socket.emit('logoutSuccess');
    });
});

server.listen(3000, () => {
    console.log('Sunucu 3000 portunda çalışıyor...');
});
