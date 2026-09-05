const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

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

function checkArenaReset(user) {
    const today = new Date().toDateString();
    if (user.arenaResetDate !== today) {
        user.arenaLimit = 5;
        user.arenaResetDate = today;
        return true;
    }
    return false;
}


const DUNGEON_DAILY_LIMIT = 5;

function getTurkeyDayKey() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Istanbul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());
}

function checkDungeonDailyReset(user) {
    const today = getTurkeyDayKey();
    const current = Array.isArray(user.dungeonDailyAttempts)
        ? Array.from(user.dungeonDailyAttempts)
        : [];

    while (current.length < 10) current.push(0);
    if (current.length > 10) current.length = 10;

    let changed = false;

    if (user.dungeonResetDate !== today) {
        for (let i = 0; i < 10; i++) current[i] = 0;
        user.dungeonResetDate = today;
        changed = true;
    }

    for (let i = 0; i < 10; i++) {
        const safeValue = Number.isFinite(Number(current[i]))
            ? Math.max(0, Math.min(DUNGEON_DAILY_LIMIT, Math.floor(Number(current[i]))))
            : 0;
        if (current[i] !== safeValue) {
            current[i] = safeValue;
            changed = true;
        }
    }

    user.dungeonDailyAttempts = current;
    if (changed) user.markModified('dungeonDailyAttempts');
    return changed;
}

function calculateOfflineGold(user) {
    if (!user.lastCollected) { 
        user.lastCollected = Date.now(); 
        return 0; 
    }
    const now = Date.now();
    const minutesPassed = Math.floor((now - user.lastCollected) / 60000);
    
    if (minutesPassed <= 0) return 0;

    let incomePerMin = 0;
    if (user.estates.includes(1)) incomePerMin += 10;
    if (user.estates.includes(2)) incomePerMin += 15;
    if (user.estates.includes(3)) incomePerMin += 20;

    const totalEarned = minutesPassed * incomePerMin;
    user.lastCollected += minutesPassed * 60000;
    
    if (totalEarned > 0) {
        user.balance += totalEarned;
    }
    
    return totalEarned;
}

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/throne_war';
mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB bağlantısı başarılı!'))
    .catch(err => console.error('MongoDB bağlantı hatası:', err));

const userSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    token: { type: String, default: null },
    lastCollected: { type: Number, default: Date.now },
    level: { type: Number, default: 1 },
    exp: { type: Number, default: 0 },
    balance: { type: Number, default: 100 },
    rubies: { type: Number, default: 15 },
    goldKeys: { type: Number, default: 0 },
    dungeonFloor: { type: Number, default: 1 },
    dungeonDailyAttempts: { type: [Number], default: () => Array(10).fill(0) },
    dungeonResetDate: { type: String, default: "" },
    str: { type: Number, default: 5 },
    vit: { type: Number, default: 5 },
    statPoints: { type: Number, default: 0 },
    hp: { type: Number, default: 100 },
    honor: { type: Number, default: 0 },
    arenaLimit: { type: Number, default: 5 },
    arenaResetDate: { type: String, default: "" },
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

// Beypazarı Karakter Tezgahları Şeması
const stallSchema = new mongoose.Schema({
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true },
    characterName: { type: String, required: true },
    locationRank: { type: Number, default: 1 }, // 1: Ana Giriş (En İyi), 2: Orta Sokak, 3: Arka Sokak
    inventory: { type: Array, default: [] }, // [{ item, price, currency: 'gold' | 'ruby' }]
    gold: { type: Number, default: 0 }, // Tezgah kasasındaki biriken altın
    rubies: { type: Number, default: 0 } // Tezgah kasasındaki biriken yakut
});
const Stall = mongoose.model('Stall', stallSchema);

const users = {}; 

const rateLimits = {};
function checkRateLimit(socketId) {
    const now = Date.now();
    if (rateLimits[socketId] && now - rateLimits[socketId] < 800) {
        return false;
    }
    rateLimits[socketId] = now;
    return true;
}

const getDefaultInventory = () => [
    { id: 'item_1', name: 'Tahta Kılıç', icon: '🗡️', type: 'weapon', strBonus: 3, vitBonus: 0, level: 0, rarity: 'Epik' },
    { id: 'item_2', name: 'Deri Zırh', icon: '🛡️', type: 'armor', strBonus: 0, vitBonus: 5, level: 0, rarity: 'Epik' }
];

io.on('connection', (socket) => {
    
    socket.on('userRegister', async (data) => {
        const { username, password } = data;
        if (!username || !password) return socket.emit('authResult', { success: false, message: "Eksik bilgi!" });
        try {
            const existing = await User.findOne({ username });
            if (existing) return socket.emit('authResult', { success: false, message: "Bu isimde gladyatör var!" });
            
            const hashedPassword = await bcrypt.hash(password, 10);
            const token = crypto.randomBytes(16).toString('hex');
            
            const newUser = new User({ 
                username, 
                password: hashedPassword, 
                token: token,
                lastCollected: Date.now(),
                inventory: getDefaultInventory(), 
                arenaResetDate: new Date().toDateString() 
            });
            await newUser.save();
            socket.emit('authResult', { success: true, message: "Kayıt başarılı!", token: token });
        } catch (err) { socket.emit('authResult', { success: false, message: "Hata oluştu." }); }
    });

    socket.on('userLogin', async (data) => {
        const { username, password } = data;
        try {
            const dbUser = await User.findOne({ username });
            if (!dbUser || !(await bcrypt.compare(password, dbUser.password))) {
                return socket.emit('authResult', { success: false, message: "Hatalı kullanıcı adı veya şifre!" });
            }
            
            const token = crypto.randomBytes(16).toString('hex');
            dbUser.token = token;
            
            const offlineGold = calculateOfflineGold(dbUser);
            checkSeferRefill(dbUser);
            checkArenaReset(dbUser);
            checkDungeonDailyReset(dbUser);
            await dbUser.save();
            
            users[socket.id] = dbUser;
            socket.emit('authResult', { success: true, message: "Giriş başarılı!", token: token });
            
            const userData = dbUser.toObject();
            userData.offlineGoldEarned = offlineGold;
            socket.emit('userData', userData);
        } catch (err) { socket.emit('authResult', { success: false, message: "Giriş hatası." }); }
    });

    socket.on('tokenLogin', async (data) => {
        const { token } = data;
        if (!token) return;
        try {
            const dbUser = await User.findOne({ token });
            if (!dbUser) {
                return socket.emit('authResult', { success: false, message: "Oturum süresi doldu.", clearToken: true });
            }
            
            const offlineGold = calculateOfflineGold(dbUser);
            checkSeferRefill(dbUser);
            checkArenaReset(dbUser);
            checkDungeonDailyReset(dbUser);
            await dbUser.save();
            
            users[socket.id] = dbUser;
            const userData = dbUser.toObject();
            userData.offlineGoldEarned = offlineGold;
            socket.emit('userData', userData);
        } catch (err) { 
            console.error(err);
        }
    });

    socket.on('logout', () => { 
        delete users[socket.id]; 
        socket.emit('logoutSuccess'); 
    });

    socket.on('distributeStat', async (statName) => {
        if (!checkRateLimit(socket.id)) return;
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
        if (!checkRateLimit(socket.id)) return;
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

    socket.on('advanceDungeonFloor', async () => {
        if (!checkRateLimit(socket.id)) return;
        const user = users[socket.id];
        if (!user) return;

        const currentFloor = user.dungeonFloor || 1;
        const requiredRubies = currentFloor * 5;

        if ((user.rubies || 0) < requiredRubies) {
            return socket.emit('dungeonResult', { 
                success: false, 
                userData: user, 
                message: `Yetersiz Yakut! ${currentFloor}. kattan bir üst kata geçmek için ${requiredRubies} Yakut 💎 gerekiyor. (Mevcut: ${user.rubies || 0} Yakut)` 
            });
        }

        user.rubies -= requiredRubies;
        user.dungeonFloor = currentFloor + 1;

        await user.save();
        socket.emit('dungeonResult', { 
            success: true, 
            userData: user, 
            message: `🚀 Başarıyla Kat ${user.dungeonFloor}'e yükseldiniz! Harcanan Yakut: ${requiredRubies} 💎` 
        });
    });

    socket.on('doDungeon', async (data) => {
        if (!checkRateLimit(socket.id)) return;
        const user = users[socket.id];
        if (!user) return;

        checkDungeonDailyReset(user);

        const floor = Number.parseInt(data?.floor, 10);
        if (!Number.isInteger(floor) || floor < 1 || floor > 10) {
            return socket.emit('dungeonResult', { success: false, userData: user, outcome: 'invalid', message: "Geçersiz zindan katı!" });
        }

        const floorAttemptIndex = floor - 1;
        const usedAttempts = Number(user.dungeonDailyAttempts?.[floorAttemptIndex]) || 0;
        const remainingAttempts = Math.max(0, DUNGEON_DAILY_LIMIT - usedAttempts);

        if (remainingAttempts <= 0) {
            return socket.emit('dungeonResult', {
                success: false,
                userData: user,
                floor,
                outcome: 'daily_limit',
                remainingAttempts: 0,
                message: `⏳ GÜNLÜK SALDIRI LİMİTİ DOLDU! ${floor}. kat için bugün 5 saldırı hakkını kullandın. Hakların Türkiye saatiyle yeni günde tekrar 5 olur.`
            });
        }

        if (floor > (user.dungeonFloor || 1)) {
            return socket.emit('dungeonResult', { success: false, userData: user, floor, outcome: 'locked', message: "🔒 Bu kata henüz erişiminiz yok! Önce katın kilidini açmalısınız." });
        }

        const floors = {
            1:  { requiredStr: 50,   hp: 20,  gold: 100,  exp: 40,   keys: 1 },
            2:  { requiredStr: 100,  hp: 45,  gold: 250,  exp: 90,   keys: 1 },
            3:  { requiredStr: 250,  hp: 90,  gold: 600,  exp: 200,  keys: 1 },
            4:  { requiredStr: 500,  hp: 120, gold: 900,  exp: 320,  keys: 1 },
            5:  { requiredStr: 750,  hp: 150, gold: 1200, exp: 400,  keys: 1 },
            6:  { requiredStr: 1000, hp: 190, gold: 1600, exp: 550,  keys: 1 },
            7:  { requiredStr: 1500, hp: 240, gold: 2100, exp: 700,  keys: 1 },
            8:  { requiredStr: 2000, hp: 300, gold: 2800, exp: 900,  keys: 1 },
            9:  { requiredStr: 3000, hp: 370, gold: 3600, exp: 1150, keys: 1 },
            10: { requiredStr: 5000, hp: 450, gold: 5000, exp: 1800, keys: 2 }
        };
        const f = floors[floor];

        let totalStr = user.str || 5;
        if (user.equipped) {
            Object.values(user.equipped).forEach(item => {
                if (item) totalStr += Number(item.strBonus) || 0;
            });
        }

        if (totalStr < f.requiredStr) {
            return socket.emit('dungeonResult', {
                success: false, userData: user, floor, totalStr, requiredStr: f.requiredStr,
                successChance: 0, outcome: 'insufficient_str',
                message: `⛔ SALDIRI BAŞLATILAMADI! ${floor}. kat için en az ${f.requiredStr} STR gerekiyor. Senin toplam gücün: ${totalStr} STR.`
            });
        }

        if (user.hp < f.hp) {
            return socket.emit('dungeonResult', {
                success: false, userData: user, floor, totalStr, requiredStr: f.requiredStr,
                successChance: 0, outcome: 'insufficient_hp',
                message: `❤️ Canın çok az! ${floor}. kata saldırmak için en az ${f.hp} HP gerekiyor. Mevcut HP: ${user.hp}.`
            });
        }

        // Gerçek saldırı bu noktada başlar; başarılı veya başarısız her savaş 1 günlük hak tüketir.
        user.dungeonDailyAttempts[floorAttemptIndex] = usedAttempts + 1;
        user.markModified('dungeonDailyAttempts');

        const remainingAfterAttack = Math.max(0, DUNGEON_DAILY_LIMIT - user.dungeonDailyAttempts[floorAttemptIndex]);

        const ratio = totalStr / f.requiredStr;
        const successChance = Math.min(95, Math.max(55, 55 + ((ratio - 1) * 35)));
        const roll = Math.random() * 100;
        const won = roll <= successChance;

        user.hp = Math.max(0, user.hp - f.hp);

        if (!won) {
            await user.save();
            return socket.emit('dungeonResult', {
                success: false, userData: user, floor, totalStr, requiredStr: f.requiredStr,
                successChance: Number(successChance.toFixed(1)), roll: Number(roll.toFixed(1)), outcome: 'defeat',
                remainingAttempts: remainingAfterAttack,
                message: `💀 KAT TEMİZLEME BAŞARISIZ! ${floor}. katta geri püskürtüldün. ⚔️ Gücün: ${totalStr} STR | 🎯 Başarı: %${successChance.toFixed(1)} | 🎲 Savaş atışı: %${roll.toFixed(1)} | ❤️ -${f.hp} HP | ❌ Ödül kazanılmadı. | 🕒 Bugün kalan saldırı: ${remainingAfterAttack}/5`
            });
        }

        user.balance += f.gold;
        user.exp += f.exp;
        user.goldKeys = (user.goldKeys || 0) + f.keys;
        let bonusMessage = ` 🔑 +${f.keys} Altın Anahtar!`;

        if (floor === 10) {
            user.rubies += 2;
            bonusMessage += " 💎 +2 Yakut!";
        }

        if (Math.random() < 0.35) {
            const dungeonItems = [
                { id: 'dg_sword', name: 'Zindan Kılıcı', icon: '🗡️', type: 'weapon', baseStr: 6, baseVit: 2 },
                { id: 'dg_shield', name: 'Karanlık Kalkan', icon: '🛡', type: 'shield', baseStr: 2, baseVit: 6 },
                { id: 'dg_ring', name: 'Ruh Yüzüğü', icon: '💍', type: 'ring', baseStr: 4, baseVit: 4 }
            ];
            const base = dungeonItems[Math.floor(Math.random() * dungeonItems.length)];
            const wonItem = {
                id: `${base.id}_${Date.now()}`, name: base.name, icon: base.icon, type: base.type,
                level: 1, rarity: 'Epik', strBonus: base.baseStr * 2, vitBonus: base.baseVit * 2
            };
            user.inventory.push(wonItem);
            user.markModified('inventory');
            bonusMessage += ` 🎁 [Nadir] ${wonItem.name} +1 düştü!`;
        }

        let levelUps = 0;
        while (user.exp >= user.level * 100) {
            user.exp -= user.level * 100;
            user.level += 1;
            user.statPoints += 3;
            levelUps++;
        }
        if (levelUps > 0) {
            user.hp = user.vit * 20;
            bonusMessage += ` ✨ ${levelUps} seviye atladın! Yeni seviyen: ${user.level}.`;
        }

        await user.save();
        socket.emit('dungeonResult', {
            success: true, userData: user, floor, totalStr, requiredStr: f.requiredStr,
            successChance: Number(successChance.toFixed(1)), roll: Number(roll.toFixed(1)), outcome: 'victory',
            remainingAttempts: remainingAfterAttack,
            message: `🏆 KAT TEMİZLEME BAŞARILI! ${floor}. kat temizlendi. ⚔️ Gücün: ${totalStr} STR | 🎯 Başarı: %${successChance.toFixed(1)} | 🎲 Savaş atışı: %${roll.toFixed(1)} | ❤️ -${f.hp} HP | 💰 +${f.gold} Altın | ⭐ +${f.exp} Tecrübe.${bonusMessage} | 🕒 Bugün kalan saldırı: ${remainingAfterAttack}/5`
        });
    });

    // --- KAVŞAK PAZARI (OYUNCU TEZGAHLARI) SİSTEMİ ---
    socket.on('getCharacterMarket', async () => {
        const user = users[socket.id];
        try {
            const stalls = await Stall.find().sort({ locationRank: 1 });
            const myStall = user ? await Stall.findOne({ ownerId: user._id }) : null;
            socket.emit('characterMarketData', { stalls, myStall });
        } catch (err) {
            console.error(err);
        }
    });

    socket.on('createStall', async ({ locationRank }) => {
        const user = users[socket.id];
        if (!user) return;
        try {
            let existing = await Stall.findOne({ ownerId: user._id });
            if (existing) return socket.emit('marketMessage', { success: false, userData: user, message: "Zaten bir tezgahınız var!" });
            
            const newStall = new Stall({
                ownerId: user._id,
                characterName: user.username,
                locationRank: parseInt(locationRank) || 1,
                inventory: [],
                gold: 0
            });
            await newStall.save();
            socket.emit('marketMessage', { success: true, userData: user, message: "Beypazarı'nda tezgahınız başarıyla kuruldu!" });
        } catch (err) {
            socket.emit('marketMessage', { success: false, userData: user, message: "Tezgah kurulurken bir hata oluştu." });
        }
    });

    socket.on('addItemToStall', async ({ itemIndex, price, currency }) => {
        const user = users[socket.id];
        if (!user) return;

        const safeIndex = Number.parseInt(itemIndex, 10);
        const safePrice = Number.parseInt(price, 10);
        const safeCurrency = currency === 'ruby' ? 'ruby' : 'gold';

        if (!Number.isInteger(safeIndex) || safeIndex < 0 || !user.inventory[safeIndex]) {
            return socket.emit('marketMessage', {
                success: false,
                userData: user,
                message: "Geçersiz eşya seçimi!"
            });
        }

        if (!Number.isInteger(safePrice) || safePrice <= 0 || safePrice > 100000000) {
            return socket.emit('marketMessage', {
                success: false,
                userData: user,
                message: "Satış fiyatı 1 ile 100.000.000 arasında olmalıdır."
            });
        }

        try {
            const stall = await Stall.findOne({ ownerId: user._id });
            if (!stall) {
                return socket.emit('marketMessage', {
                    success: false,
                    userData: user,
                    message: "Önce bir tezgah açmalısınız!"
                });
            }

            const item = user.inventory.splice(safeIndex, 1)[0];
            stall.inventory.push({
                item,
                price: safePrice,
                currency: safeCurrency
            });

            user.markModified('inventory');
            stall.markModified('inventory');

            await user.save();
            await stall.save();

            const currencyText = safeCurrency === 'ruby'
                ? `${safePrice} Yakut 💎`
                : `${safePrice} Altın 🪙`;

            socket.emit('marketMessage', {
                success: true,
                userData: user,
                message: `${item.name} +${Number(item.level) || 0}, ${currencyText} karşılığında Beypazarı'nda satışa konuldu!`
            });
            socket.emit('statUpdated', user);
        } catch (err) {
            console.error(err);
            socket.emit('marketMessage', {
                success: false,
                userData: user,
                message: "Ürün satışa konulurken işlem başarısız oldu."
            });
        }
    });

    socket.on('removeItemFromStall', async ({ stallItemIndex }) => {
        const user = users[socket.id];
        if (!user) return;
        try {
            const stall = await Stall.findOne({ ownerId: user._id });
            if (!stall || !stall.inventory[stallItemIndex]) return;

            const soldObj = stall.inventory.splice(stallItemIndex, 1)[0];
            user.inventory.push(soldObj.item);
            user.markModified('inventory');
            await user.save();
            await stall.save();

            socket.emit('marketMessage', { success: true, userData: user, message: `${soldObj.item.name} tezgahtan geri alındı!` });
            socket.emit('statUpdated', user);
        } catch (err) {
            socket.emit('marketMessage', { success: false, userData: user, message: "İşlem başarısız." });
        }
    });

    socket.on('buyStallItem', async ({ stallId, stallItemIndex }) => {
        const buyer = users[socket.id];
        if (!buyer) return;

        const safeIndex = Number.parseInt(stallItemIndex, 10);
        if (!Number.isInteger(safeIndex) || safeIndex < 0) {
            return socket.emit('marketMessage', {
                success: false,
                userData: buyer,
                message: "Geçersiz ürün seçimi!"
            });
        }

        try {
            const stall = await Stall.findById(stallId);
            if (!stall || !stall.inventory[safeIndex]) {
                return socket.emit('marketMessage', {
                    success: false,
                    userData: buyer,
                    message: "Bu ürün artık mevcut değil!"
                });
            }

            if (stall.ownerId.toString() === buyer._id.toString()) {
                return socket.emit('marketMessage', {
                    success: false,
                    userData: buyer,
                    message: "Kendi ürününüzü satın alamazsınız!"
                });
            }

            const targetObj = stall.inventory[safeIndex];
            const price = Number.parseInt(targetObj.price, 10);
            // Eski ilanlarda currency alanı olmadığı için onları otomatik olarak altın kabul ediyoruz.
            const currency = targetObj.currency === 'ruby' ? 'ruby' : 'gold';

            if (!Number.isInteger(price) || price <= 0) {
                return socket.emit('marketMessage', {
                    success: false,
                    userData: buyer,
                    message: "Ürünün satış fiyatı geçersiz!"
                });
            }

            if (currency === 'ruby') {
                if ((buyer.rubies || 0) < price) {
                    return socket.emit('marketMessage', {
                        success: false,
                        userData: buyer,
                        message: `Yetersiz Yakut! Bu ürün için ${price} Yakut 💎 gerekiyor.`
                    });
                }

                buyer.rubies -= price;
                stall.rubies = (stall.rubies || 0) + price;
            } else {
                if ((buyer.balance || 0) < price) {
                    return socket.emit('marketMessage', {
                        success: false,
                        userData: buyer,
                        message: `Yetersiz Altın! Bu ürün için ${price} Altın 🪙 gerekiyor.`
                    });
                }

                buyer.balance -= price;
                stall.gold = (stall.gold || 0) + price;
            }

            stall.inventory.splice(safeIndex, 1);
            buyer.inventory.push(targetObj.item);

            buyer.markModified('inventory');
            stall.markModified('inventory');

            await buyer.save();
            await stall.save();

            const currencyText = currency === 'ruby'
                ? `${price} Yakut 💎`
                : `${price} Altın 🪙`;

            // Satıcı çevrimiçiyse bilgilendir.
            for (let sId in users) {
                if (users[sId]._id.toString() === stall.ownerId.toString()) {
                    io.to(sId).emit('marketMessage', {
                        success: true,
                        message: `Beypazarı tezgahınızdan ${targetObj.item.name} +${Number(targetObj.item.level) || 0}, ${currencyText} karşılığında satıldı!`
                    });
                }
            }

            socket.emit('marketMessage', {
                success: true,
                userData: buyer,
                message: `${targetObj.item.name} +${Number(targetObj.item.level) || 0}, ${currencyText} karşılığında satın alındı!`
            });
            socket.emit('statUpdated', buyer);
        } catch (err) {
            console.error(err);
            socket.emit('marketMessage', {
                success: false,
                userData: buyer,
                message: "Satın alma işleminde hata oluştu."
            });
        }
    });

    socket.on('collectStallGold', async () => {
        const user = users[socket.id];
        if (!user) return;

        try {
            const stall = await Stall.findOne({ ownerId: user._id });
            if (!stall) {
                return socket.emit('marketMessage', {
                    success: false,
                    userData: user,
                    message: "Tezgah bulunamadı!"
                });
            }

            const collectedGold = Math.max(0, Number(stall.gold) || 0);
            const collectedRubies = Math.max(0, Number(stall.rubies) || 0);

            if (collectedGold <= 0 && collectedRubies <= 0) {
                return socket.emit('marketMessage', {
                    success: false,
                    userData: user,
                    message: "Tezgah kasasında toplanacak Altın veya Yakut yok!"
                });
            }

            stall.gold = 0;
            stall.rubies = 0;

            user.balance += collectedGold;
            user.rubies = (user.rubies || 0) + collectedRubies;

            await user.save();
            await stall.save();

            const parts = [];
            if (collectedGold > 0) parts.push(`${collectedGold} Altın 🪙`);
            if (collectedRubies > 0) parts.push(`${collectedRubies} Yakut 💎`);

            socket.emit('marketMessage', {
                success: true,
                userData: user,
                message: `${parts.join(' ve ')} Beypazarı tezgah kasasından toplandı!`
            });
            socket.emit('statUpdated', user);
        } catch (err) {
            console.error(err);
            socket.emit('marketMessage', {
                success: false,
                userData: user,
                message: "Tezgah kazançları toplanamadı."
            });
        }
    });

    // --- KAVŞAK PAZARI BİTİŞ ---

    socket.on('openGoldChest', async () => {
        if (!checkRateLimit(socket.id)) return;
        const user = users[socket.id];
        if (!user) return;

        if ((user.goldKeys || 0) < 1) {
            return socket.emit('marketResult', { success: false, userData: user, message: "Altın Sandığı açmak için en az 1 adet Altın Anahtarınız olmalı!" });
        }

        user.goldKeys -= 1;
        const rubyWon = 10;
        user.rubies += rubyWon;

        await user.save();
        socket.emit('marketResult', { success: true, userData: user, message: `📦 Altın Sandık açıldı! Envanterinize ${rubyWon} adet Yakut 💎 eklendi!` });
    });

    socket.on('buySuluhanItem', async (data) => {
        if (!checkRateLimit(socket.id)) return;
        const user = users[socket.id];
        if (!user) return;

        const suluhanItems = {
            1: { name: 'Güneş Kılıcı', icon: '⚔️', type: 'weapon', rarity: 'Epik', goldCost: 5000, rubyCost: 1000, strBonus: 12, vitBonus: 4, level: 1 },
            2: { name: 'Vezir Zırhı', icon: '🛡️', type: 'armor', rarity: 'Epik', goldCost: 8000, rubyCost: 750, strBonus: 5, vitBonus: 15, level: 1 },
            3: { name: 'Sultan Tacı', icon: '👑', type: 'helmet', rarity: 'Epik', goldCost: 4000, rubyCost: 450, strBonus: 4, vitBonus: 10, level: 1 },
            4: { name: 'Hünkar Yüzüğü', icon: '💍', type: 'ring', rarity: 'Epik', goldCost: 10000, rubyCost: 300, strBonus: 8, vitBonus: 8, level: 1 },
            5: { name: 'Şehzade Çizmesi', icon: '👢', type: 'boots', rarity: 'Epik', goldCost: 2500, rubyCost: 200, strBonus: 6, vitBonus: 6, level: 1 }
        };

        const itemTemplate = suluhanItems[data.itemId];
        if (!itemTemplate) {
            return socket.emit('suluhanResult', { success: false, userData: user, message: "Geçersiz eşya seçimi!" });
        }

        if (user.balance < itemTemplate.goldCost || (user.rubies || 0) < itemTemplate.rubyCost) {
            return socket.emit('suluhanResult', { 
                success: false, 
                userData: user, 
                message: `Yetersiz kaynak! Bu eşya için ${itemTemplate.goldCost} Altın ve ${itemTemplate.rubyCost} Yakut gerekiyor.` 
            });
        }

        user.balance -= itemTemplate.goldCost;
        user.rubies -= itemTemplate.rubyCost;

        const newItem = {
            id: `suluhan_${data.itemId}_${Date.now()}`,
            name: itemTemplate.name,
            icon: itemTemplate.icon,
            type: itemTemplate.type,
            level: itemTemplate.level,
            rarity: itemTemplate.rarity,
            strBonus: itemTemplate.strBonus,
            vitBonus: itemTemplate.vitBonus
        };

        user.inventory.push(newItem);
        user.markModified('inventory');
        await user.save();

        socket.emit('suluhanResult', { 
            success: true, 
            userData: user, 
            message: `🏛️ Suluhan Çarşısı'ndan [${itemTemplate.rarity}] ${itemTemplate.name} satın alındı!` 
        });
    });

    socket.on('getArenaOpponents', async () => {
        if (!checkRateLimit(socket.id)) return;
        const user = users[socket.id];
        if (!user) return;
        checkArenaReset(user);
        await user.save();
        try {
            const opponents = await User.find({ _id: { $ne: user._id } }).select('username level str vit equipped honor').limit(5);
            socket.emit('arenaOpponentsList', opponents);
        } catch (err) {
            socket.emit('arenaResult', { success: false, message: "Rakipler yüklenemedi." });
        }
    });

    socket.on('attackPlayer', async (data) => {
        if (!checkRateLimit(socket.id)) return;
        const attacker = users[socket.id];
        if (!attacker) return;

        checkArenaReset(attacker);
        if (attacker.arenaLimit <= 0) {
            return socket.emit('arenaResult', { success: false, userData: attacker, message: "Günlük 5 arena hakkın doldu!" });
        }

        try {
            const defender = await User.findById(data.defenderId);
            if (!defender) return socket.emit('arenaResult', { success: false, message: "Rakip bulunamadı!" });

            const calculatePower = (u) => {
                let strB = u.str || 5, vitB = u.vit || 5;
                if (u.equipped) {
                    Object.values(u.equipped).forEach(item => {
                        if (item) { strB += (item.strBonus || 0); vitB += (item.vitBonus || 0); }
                    });
                }
                return (strB * 2) + vitB;
            };

            const atkPower = calculatePower(attacker);
            const defPower = calculatePower(defender);

            const atkRoll = atkPower + (Math.random() * 20);
            const defRoll = defPower + (Math.random() * 20);

            attacker.arenaLimit -= 1;

            if (atkRoll >= defRoll) {
                const goldReward = Math.floor(Math.random() * 50) + 30;
                attacker.balance += goldReward;
                attacker.honor = (attacker.honor || 0) + 15;
                await attacker.save();
                
                socket.emit('arenaResult', { 
                    success: true, 
                    userData: attacker, 
                    message: `🏆 Zafer! ${defender.username} adlı gladyatörü alt ettin. Ödül: +${goldReward} Altın, +15 Onur!` 
                });
            } else {
                attacker.honor = Math.max(0, (attacker.honor || 0) - 5);
                await attacker.save();

                socket.emit('arenaResult', { 
                    success: false, 
                    userData: attacker, 
                    message: `💀 Mağlubiyet! ${defender.username} direncini kırdı. 5 Onur kaybettin.` 
                });
            }
        } catch (err) {
            socket.emit('arenaResult', { success: false, message: "Savaş sırasında bir hata oluştu." });
        }
    });

    socket.on('usePotion', async () => {
        if (!checkRateLimit(socket.id)) return;
        const user = users[socket.id];

        if (!user || user.balance < 25000) {
            return socket.emit('marketResult', {
                success: false,
                userData: user,
                message: "Yetersiz altın! Can İksiri için 25.000 Altın gerekiyor."
            });
        }

        // Maksimum HP, Nitelikler ve üst can barındaki hesapla aynı:
        // temel VIT + kuşanılmış ekipmanların VIT bonusları.
        let totalVit = user.vit || 5;
        if (user.equipped) {
            Object.values(user.equipped).forEach(item => {
                if (item) totalVit += Number(item.vitBonus) || 0;
            });
        }

        const maxHp = totalVit * 20;

        user.balance -= 25000;
        user.hp = maxHp;

        await user.save();

        socket.emit('marketResult', {
            success: true,
            userData: user,
            message: `Can İksiri içildi! HP tamamen doldu: ${user.hp}/${maxHp} ❤️`
        });
    });

    socket.on('refillSefer', async () => {
        if (!checkRateLimit(socket.id)) return;
        const user = users[socket.id];
        if (!user || user.balance < 25000) return socket.emit('marketResult', { success: false, userData: user, message: "Yetersiz altın! Sefer İksiri için 25.000 Altın gerekiyor." });
        user.balance -= 25000; user.seferLimiti = MAX_SEFER_LIMITI; user.seferNextRefill = null;
        await user.save();
        socket.emit('marketResult', { success: true, userData: user, message: "Sefer limitiniz yenilendi!" });
    });

    socket.on('buyMysteryBox', async () => {
        if (!checkRateLimit(socket.id)) return;
        const user = users[socket.id];
        if (!user || user.balance < 10000) return socket.emit('marketResult', { success: false, userData: user, message: "Sandık için 300 altın gerekli!" });
        
        user.balance -= 10000;
        
        const randRarity = Math.random();
        let rarity = 'Sıradan';
        let statMultiplier = 1;
        let bonusLevel = Math.floor(Math.random() * 2);
        
        if (randRarity > 0.90) {
            rarity = 'Epik';
            statMultiplier = 3;
            bonusLevel = 2;
        } else if (randRarity > 0.60) {
            rarity = 'Nadir';
            statMultiplier = 2;
            bonusLevel = Math.floor(Math.random() * 2) + 1;
        }
        
        const baseItems = [
            { id: 'item_sword', name: 'Savaş Baltası', icon: '🪓', type: 'weapon', baseStr: 7, baseVit: 2 },
            { id: 'item_shield', name: 'Demir Kalkan', icon: '🛡', type: 'shield', baseStr: 2, baseVit: 6 },
            { id: 'item_ring', name: 'Kudret Yüzüğü', icon: '💍', type: 'ring', baseStr: 4, baseVit: 4 },
            { id: 'item_helmet', name: 'Çelik Miğfer', icon: '🪖', type: 'helmet', baseStr: 1, baseVit: 5 },
            { id: 'item_armor', name: 'Savaş Zırhı', icon: '🛡️', type: 'armor', baseStr: 3, baseVit: 7 },
            { id: 'item_boots', name: 'Demir Çizmeler', icon: '👢', type: 'boots', baseStr: 2, baseVit: 4 },
            { id: 'item_gloves', name: 'Deri Eldiven', icon: '🧤', type: 'gloves', baseStr: 3, baseVit: 3 },
            { id: 'item_necklace', name: 'Antik Kolye', icon: '📿', type: 'necklace', baseStr: 5, baseVit: 2 }
        ];
        const base = baseItems[Math.floor(Math.random() * baseItems.length)];
        
        const wonItem = {
            id: base.id,
            name: base.name.replace(/\s*\+\d+$/, ''),
            icon: base.icon,
            type: base.type,
            level: bonusLevel,
            rarity: rarity,
            strBonus: (base.baseStr * statMultiplier) + (bonusLevel * 2),
            vitBonus: (base.baseVit * statMultiplier) + (bonusLevel * 2)
        };

        user.inventory.push(wonItem);
        user.markModified('inventory');
        await user.save();
        socket.emit('marketResult', { success: true, userData: user, message: `🎁 Sandıktan [${rarity}] ${wonItem.name} +${wonItem.level} çıktı!` });
    });

    socket.on('buyEstate', async (data) => {
        if (!checkRateLimit(socket.id)) return;
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
        if (!checkRateLimit(socket.id)) return;
        const user = users[socket.id];
        if (!user || !user.inventory[data.itemIndex]) return;
        const item = user.inventory[data.itemIndex];
        const currentLvl = item.level || 0;
        const nextLvl = currentLvl + 1;
        
        const goldCost = nextLvl * 150;
        const rubyCost = nextLvl * 1; 

        if (user.balance < goldCost || (user.rubies || 0) < rubyCost) {
            return socket.emit('forgeResult', { 
                success: false, 
                userData: user, 
                message: `Yetersiz Altın veya Yakut! Gerekli: ${goldCost} Altın 🪙 ve ${rubyCost} Yakut 💎` 
            });
        }

        user.balance -= goldCost;
        user.rubies -= rubyCost;
        item.name = (item.name || 'Eşya').replace(/\s*\+\d+$/, '');
        item.level = nextLvl;
        
        const statBoost = item.rarity === 'Epik' ? 4 : (item.rarity === 'Nadir' ? 3 : 2);
        
        item.strBonus = (item.strBonus || 0) + statBoost;
        item.vitBonus = (item.vitBonus || 0) + statBoost;
        
        user.markModified('inventory');
        await user.save();
        socket.emit('forgeResult', { success: true, userData: user, message: `Eşya +${item.level} seviyesine geliştirildi! (${goldCost} Altın, ${rubyCost} Yakut harcandı)` });
    });

    socket.on('equipItem', async (data) => {
        const user = users[socket.id];
        if (!user || !user.inventory[data.itemIndex]) return;
        const item = user.inventory[data.itemIndex];
        item.name = (item.name || 'Eşya').replace(/\s*\+\d+$/, '');
        const old = user.equipped[item.type];
        if (old) old.name = (old.name || 'Eşya').replace(/\s*\+\d+$/, '');
        
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
        const item = user.equipped[data.slot];
        item.name = (item.name || 'Eşya').replace(/\s*\+\d+$/, '');
        user.inventory.push(item);
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
        if (!checkRateLimit(socket.id)) return socket.emit('errorMessage', "Çok hızlı mesaj gönderiyorsun!");
        const safeMsg = data.message.substring(0, 100); 
        io.emit('receiveChatMessage', { username: users[socket.id]?.username, message: safeMsg });
    });

    socket.on('disconnect', () => delete users[socket.id]);
});

setInterval(async () => {
    for (const id in users) {
        const u = users[id];
        let inc = 0;
        if (u.estates.includes(1)) inc += 10;
        if (u.estates.includes(2)) inc += 15;
        if (u.estates.includes(3)) inc += 20;
        if (inc > 0) {
            u.balance += inc;
            u.lastCollected = Date.now();
            await User.updateOne({ _id: u._id }, { $set: { balance: u.balance, lastCollected: u.lastCollected } });
            io.to(id).emit('statUpdated', u);
        }
    }
}, 60000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Sunucu aktif: ${PORT}`));
