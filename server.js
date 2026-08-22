const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(__dirname + '/public'));

// Sabitler ve Görev Listesi
const MAX_SEFER_LIMITI = 20;
const REFILL_INTERVAL = 30 * 60 * 1000; // 30 Dakika (milisaniye)

const QUESTS = {
    1:  { name: "Karanlık Orman", reqLevel: 1, gold: 45, exp: 20, hpLoss: 15 },
    2:  { name: "Unutulmuş Tapınak", reqLevel: 3, gold: 120, exp: 55, hpLoss: 35 },
    3:  { name: "Ejderha Dağı", reqLevel: 5, gold: 300, exp: 140, hpLoss: 70 },
    4:  { name: "Kanlı Vadi", reqLevel: 10, gold: 650, exp: 300, hpLoss: 120 },
    5:  { name: "Yeraltı Zindanları", reqLevel: 15, gold: 1200, exp: 550, hpLoss: 180 },
    6:  { name: "Buzul Geçidi", reqLevel: 20, gold: 2100, exp: 950, hpLoss: 250 },
    7:  { name: "Gölge Kalesi", reqLevel: 25, gold: 3500, exp: 1500, hpLoss: 330 },
    8:  { name: "Alev Havzası", reqLevel: 30, gold: 5500, exp: 2300, hpLoss: 420 },
    9:  { name: "Kadim Harabeler", reqLevel: 35, gold: 8200, exp: 3400, hpLoss: 520 },
    10: { name: "Kabus Diyarı", reqLevel: 40, gold: 12000, exp: 4800, hpLoss: 630 },
    11: { name: "Devler Yuvası", reqLevel: 45, gold: 17000, exp: 6700, hpLoss: 750 },
    12: { name: "Ölümcül Bataklık", reqLevel: 50, gold: 23500, exp: 9000, hpLoss: 880 },
    13: { name: "Kutsal Taht Salonu", reqLevel: 55, gold: 32000, exp: 12000, hpLoss: 1000 }
};

function checkSeferRefill(user) {
    const now = Date.now();
    if (user.seferLimiti <= 0 && user.seferNextRefill && now >= user.seferNextRefill) {
        user.seferLimiti = MAX_SEFER_LIMITI;
        user.seferNextRefill = null;
        return true;
    }
    return false;
}

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
    statPoints: { type: Number, default: 0 },
    hp: { type: Number, default: 100 },
    seferLimiti: { type: Number, default: 20 },
    seferNextRefill: { type: Number, default: null },
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
const users = {}; 

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
        if (!username || !password || username.trim() === '' || password.trim() === '') {
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
                inventory: getDefaultInventory() 
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

            if (checkSeferRefill(dbUser)) {
                await dbUser.save();
            }

            users[socket.id] = dbUser;
            socket.emit('userData', dbUser);
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
            socket.emit('statUpdated', user);
        }
    });

    // Görev (Sefer) Sistemi
    socket.on('doQuest', async (data = {}) => {
        const user = users[socket.id];
        if (!user) {
            return socket.emit('questResult', { 
                success: false, 
                message: "Oturum zaman aşımına uğradı, lütfen sayfayı yenileyip tekrar giriş yapın." 
            });
        }

        checkSeferRefill(user);

        const questId = (data && data.questId) ? data.questId : 1;
        const quest = QUESTS[questId];

        if (!quest) {
            return socket.emit('questResult', { success: false, message: "Geçersiz sefer seçimi!" });
        }

        if (user.level < quest.reqLevel) {
            return socket.emit('questResult', { 
                success: false, 
                message: `Bu sefere katılabilmek için en az Level ${quest.reqLevel} olmalısınız!` 
            });
        }

        if (user.hp <= 0) {
            return socket.emit('questResult', { success: false, message: "Canınız yetersiz! Pazar yerinden iksir alabilirsiniz." });
        }

        if (user.seferLimiti <= 0) {
            const kalanDakika = Math.ceil((user.seferNextRefill - Date.now()) / (1000 * 60));
            return socket.emit('questResult', { 
                success: false, 
                message: `Sefer hakkınız bitti! Yenilenmeye kalan süre: ${kalanDakika} dakika.` 
            });
        }

        user.seferLimiti -= 1;
        if (user.seferLimiti === 0) {
            user.seferNextRefill = Date.now() + REFILL_INTERVAL;
        }

        user.hp = Math.max(0, user.hp - quest.hpLoss);
        user.balance += quest.gold;
        user.exp += quest.exp;

        let maxExp = user.level * 100;
        let levelUpMsg = "";
        while (user.exp >= maxExp) {
            user.level += 1;
            user.exp -= maxExp;
            user.statPoints += 3;
            user.hp = user.vit * 20;
            maxExp = user.level * 100;
            levelUpMsg = " SEVİYE ATLADIN!";
        }

        await user.save();
        socket.emit('statUpdated', user);
        socket.emit('questResult', { 
            success: true, 
            userData: user, 
            message: `${quest.name} seferi başarılı!${levelUpMsg}`, 
            goldEarned: quest.gold, 
            expEarned: quest.exp, 
            hpLost: quest.hpLoss 
        });
    });

    // Tımar Satın Alma
    socket.on('buyEstate', async (data) => {
        const user = users[socket.id];
        if (!user) return;
        
        let cost = 0;
        if (data.estateId === 1) cost = 500;
        if (data.estateId === 2) cost = 2000;
        if (data.estateId === 3) cost = 7500;

        if (user.estates.includes(data.estateId)) return socket.emit('marketResult', { userData: user, message: "Bu mülke zaten sahipsiniz!" });
        if (user.balance < cost) return socket.emit('marketResult', { userData: user, message: "Yeterli altınınız yok!" });

        user.balance -= cost;
        user.estates.push(data.estateId);
        await user.save();
        socket.emit('marketResult', { userData: user, message: "Mülk başarıyla satın alındı! Artık pasif gelir getirecek." });
    });

    // Demirci (+ Basma)
    socket.on('upgradeItem', async (data) => {
        const user = users[socket.id];
        if (!user) return;

        const type = data.itemType;
        if (user.upgrades[type] !== undefined) {
            const cost = (user.upgrades[type] + 1) * 100;
            if (user.balance >= cost) {
                user.balance -= cost;
                user.upgrades[type] += 1;
                user.markModified('upgrades');
                await user.save();
                socket.emit('forgeResult', { userData: user, itemType: type, newLevel: user.upgrades[type], message: `${type.toUpperCase()} başarıyla +${user.upgrades[type]} seviyesine yükseltildi!` });
            } else {
                socket.emit('forgeResult', { userData: user, itemType: type, newLevel: user.upgrades[type], message: "Geliştirme için yeterli altınınız yok!" });
            }
        }
    });

    // Can İksiri
    socket.on('usePotion', async () => {
        const user = users[socket.id];
        if (user && user.balance >= 50) {
            user.balance -= 50; 
            user.hp = user.vit * 20;
            await user.save();
            socket.emit('statUpdated', user);
            socket.emit('marketResult', { userData: user, message: "Canınız yenilendi!" });
        }
    });

    // Sefer Limiti Yenileme İksiri (50 Altın)
    socket.on('refillSefer', async () => {
        const user = users[socket.id];
        if (!user) return;

        if (user.seferLimiti >= MAX_SEFER_LIMITI) {
            return socket.emit('marketResult', { userData: user, message: "Sefer hakkınız zaten maksimum seviyede!" });
        }

        if (user.balance < 50) {
            return socket.emit('marketResult', { userData: user, message: "Yeterli altınınız yok!" });
        }

        user.balance -= 50;
        user.seferLimiti = MAX_SEFER_LIMITI;
        user.seferNextRefill = null;
        await user.save();

        socket.emit('statUpdated', user);
        socket.emit('marketResult', { userData: user, message: "Sefer limitiniz 20/20 olarak yenilendi!" });
    });

    // Ekipman Kuşanma/Çıkarma
    socket.on('equipItem', async (data) => {
        const user = users[socket.id];
        if (!user || data.itemIndex < 0 || data.itemIndex >= user.inventory.length) return;
        
        const item = user.inventory[data.itemIndex];
        const old = user.equipped[item.type];
        user.inventory.splice(data.itemIndex, 1);
        if (old) user.inventory.push(old);
        user.equipped[item.type] = item;
        user.markModified('equipped'); 
        user.markModified('inventory');
        await user.save();
        socket.emit('statUpdated', user);
    });

    socket.on('unequipItem', async (data) => {
        const user = users[socket.id];
        if (!user || !user.equipped[data.slot]) return;
        user.inventory.push(user.equipped[data.slot]);
        user.equipped[data.slot] = null;
        user.markModified('equipped'); 
        user.markModified('inventory');
        await user.save();
        socket.emit('statUpdated', user);
    });

    // Sohbet
    socket.on('sendChatMessage', (data) => {
        io.emit('receiveChatMessage', { username: users[socket.id]?.username, message: data.message });
    });

    socket.on('disconnect', () => delete users[socket.id]);
});

// PASİF GELİR VE OTOMATİK CAN YENİLEME DÖNGÜSÜ (60 Saniyede Bir)
setInterval(async () => {
    for (const socketId in users) {
        const user = users[socketId];
        let isUpdated = false;

        let income = 0;
        if (user.estates.includes(1)) income += 10;
        if (user.estates.includes(2)) income += 45;
        if (user.estates.includes(3)) income += 180;

        if (income > 0) {
            user.balance += income;
            isUpdated = true;
        }

        const maxHp = user.vit * 20;
        if (user.hp < maxHp) {
            user.hp = Math.min(maxHp, user.hp + 10);
            isUpdated = true;
        }

        if (isUpdated) {
            await user.save();
            io.to(socketId).emit('statUpdated', user);
        }
    }
}, 60000); 

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Sunucu http://localhost:${PORT} aktif.`));
