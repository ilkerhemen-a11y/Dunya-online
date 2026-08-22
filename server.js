const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname + '/public'));

// 1. MongoDB Bağlantısı (Kendi veritabanı adresini buraya yazabilirsin)
mongoose.connect('mongodb://localhost:27017/throne_war', {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log('MongoDB bağlantısı başarılı!');
}).catch(err => {
    console.error('MongoDB bağlantı hatası:', err);
});

// 2. Kullanıcı Veritabanı Şeması (Model)
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
const users = {}; // Aktif socket bağlantıları için

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

    // Giriş Yapma / Kayıt Yükleme
    socket.on('userLogin', async (data) => {
        const username = data.username ? data.username.trim() : 'Gladyatör';
        
        try {
            // Veritabanında bu isimle kullanıcı var mı bak
            let dbUser = await User.findOne({ username });

            if (!dbUser) {
                // Yoksa sıfırdan oluştur ve kaydet
                dbUser = new User({
                    username: username,
                    inventory: getDefaultInventory()
                });
                await dbUser.save();
            }

            // Aktif kullanıcılar listesine ekle
            users[socket.id] = dbUser;
            socket.emit('userData', dbUser);
        } catch (err) {
            console.error("Giriş hatası:", err);
        }
    });

    // Eşya Kuşanma
    socket.on('equipItem', async (data) => {
        const user = users[socket.id];
        if (!user) return;

        const { itemIndex } = data;
        if (itemIndex === undefined || !user.inventory[itemIndex]) return;

        const itemToEquip = user.inventory[itemIndex];
        const slotType = itemToEquip.type;

        const currentlyEquipped = user.equipped[slotType];
        user.inventory.splice(itemIndex, 1);

        if (currentlyEquipped) {
            user.inventory.push(currentlyEquipped);
        }

        user.equipped[slotType] = itemToEquip;
        
        await user.save(); // Anlık kaydet
        socket.emit('statUpdated', user);
    });

    // Eşya Çıkarma
    socket.on('unequipItem', async (data) => {
        const user = users[socket.id];
        if (!user) return;

        const { slot } = data;
        if (!slot || !user.equipped[slot]) return;

        const unequippedItem = user.equipped[slot];
        user.equipped[slot] = null;
        user.inventory.push(unequippedItem);

        await user.save(); // Anlık kaydet
        socket.emit('statUpdated', user);
    });

    // Sefer / Görev Yapma
    socket.on('doQuest', async (data) => {
        const user = users[socket.id];
        if (!user) return;

        const now = Date.now();
        const COOLDOWN_TIME = 60 * 60 * 1000; // 1 Saat

        if (user.seferNextRefill && now >= user.seferNextRefill) {
            user.seferLimiti = 20;
            user.seferNextRefill = null;
        }

        if (user.hp <= 0) {
            return socket.emit('questResult', {
                success: false,
                message: "Canınız (HP) tükenmiş! Sefer düzenlemek için can iksiri içmelisiniz.",
                userData: user
            });
        }

        if (user.seferLimiti <= 0) {
            return socket.emit('questResult', {
                success: false,
                message: "Sefer limitiniz dolmuştur! Yenilenmesi için geri sayımın tamamlanmasını bekleyin.",
                userData: user
            });
        }

        user.seferLimiti -= 1;
        if (!user.seferNextRefill) {
            user.seferNextRefill = now + COOLDOWN_TIME;
        }

        const questId = data.questId || 1;
        const hpLost = Math.floor(Math.random() * (questId * 12)) + 5;
        user.hp = Math.max(0, user.hp - hpLost);

        const goldEarned = questId * 45 + Math.floor(Math.random() * 15);
        const expEarned = questId * 25;

        user.balance += goldEarned;
        user.exp += expEarned;

        const maxExp = user.level * 100;
        if (user.exp >= maxExp) {
            user.level += 1;
            user.exp -= maxExp;
            user.statPoints += 3;
        }

        await user.save(); // Anlık kaydet

        socket.emit('questResult', {
            success: true,
            message: "Sefer başarıyla tamamlandı!",
            goldEarned: goldEarned,
            expEarned: expEarned,
            hpLost: hpLost,
            userData: user
        });
    });

    // Nitelik Dağıtma
    socket.on('distributeStat', async (statName) => {
        const user = users[socket.id];
        if (!user || user.statPoints <= 0) return;

        if (statName === 'str') {
            user.str += 1;
            user.statPoints -= 1;
        } else if (statName === 'vit') {
            user.vit += 1;
            user.statPoints -= 1;
            user.hp = user.vit * 20;
        }

        await user.save(); // Anlık kaydet
        socket.emit('statUpdated', user);
    });

    // Can İksiri İçme
    socket.on('usePotion', async () => {
        const user = users[socket.id];
        if (!user) return;

        const potionCost = 50;
        if (user.balance < potionCost) {
            return socket.emit('questResult', {
                success: false,
                message: "İksir satın almak için yeterli altınınız yok!",
                userData: user
            });
        }

        user.balance -= potionCost;
        user.hp = user.vit * 20;

        await user.save(); // Anlık kaydet
        socket.emit('questResult', {
            success: true,
            message: "Can iksiri içildi! Canınız tamamen tazelendi.",
            goldEarned: 0,
            expEarned: 0,
            hpLost: 0,
            userData: user
        });
    });

    // Demirhane (+ Basma)
    socket.on('upgradeItem', async (data) => {
        const user = users[socket.id];
        if (!user) return;

        const itemType = data.itemType;
        const currentLvl = user.upgrades[itemType] || 0;
        const cost = (currentLvl + 1) * 100;

        if (user.balance < cost) {
            return socket.emit('marketResult', {
                success: false,
                message: "Geliştirme için yeterli altınınız bulunmuyor!",
                userData: user
            });
        }

        user.balance -= cost;
        user.upgrades[itemType] = currentLvl + 1;
        user.markModified('upgrades'); // Mongoose iç içe nesne güncellemeleri için şart

        await user.save(); // Anlık kaydet

        socket.emit('forgeResult', {
            success: true,
            itemType: itemType,
            newLevel: user.upgrades[itemType],
            message: `${itemType.toUpperCase()} başarıyla +${user.upgrades[itemType]} seviyesine yükseltildi!`,
            userData: user
        });
    });

    // Sohbet Mesajı
    socket.on('sendChatMessage', (data) => {
        const user = users[socket.id];
        if (!user || !data.message) return;

        io.emit('receiveChatMessage', {
            username: user.username,
            message: data.message
        });
    });

    // Bağlantı Kopması
    socket.on('disconnect', () => {
        console.log('Gladyatör ayrıldı:', socket.id);
        delete users[socket.id];
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu http://localhost:${PORT} üzerinde aktif.`);
});
