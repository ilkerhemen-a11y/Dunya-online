const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

const getDefaultInventory = () => [
    { id: 'item_1', name: 'Tahta Kılıç', icon: 'https://i.hizliresim.com/bijxhvw1.jpg', type: 'weapon', strBonus: 3, vitBonus: 0, isImage: true },
    { id: 'item_2', name: 'Deri Zırh', icon: 'https://i.hizliresim.com/hnneaa5l.jpg', type: 'armor', strBonus: 0, vitBonus: 5, isImage: true },
    { id: 'item_3', name: 'Bakır Kolye', icon: '📿', type: 'necklace', strBonus: 1, vitBonus: 2 },
    { id: 'item_4', name: 'Çelik Kask', icon: 'https://i.hizliresim.com/twgkfi5q.jpg', type: 'helmet', strBonus: 1, vitBonus: 3, isImage: true },
    { id: 'item_5', name: 'Tahta Kalkan', icon: '🪵', type: 'shield', strBonus: 0, vitBonus: 4 },
    { id: 'item_6', name: 'Bronz Yüzük', icon: '💍', type: 'ring', strBonus: 2, vitBonus: 1 },
    { id: 'item_7', name: 'Kumaş Eldiven', icon: '🧤', type: 'gloves', strBonus: 1, vitBonus: 1 },
    { id: 'item_8', name: 'Eski Çizme', icon: '🥾', type: 'boots', strBonus: 0, vitBonus: 2 }
];

io.on('connection', (socket) => {
    let user = null;

    socket.on('userLogin', (data) => {
        const username = data.username || 'Gladyatör';
        user = {
            username: username,
            balance: 1000,
            rubies: 10,
            level: 1,
            exp: 0,
            str: 5,
            vit: 5,
            statPoints: 0,
            hp: 100,
            seferLimiti: 20,
            seferNextRefill: Date.now(),
            equipped: {},
            inventory: getDefaultInventory(),
            upgrades: { weapon: 0, armor: 0, helmet: 0 },
            estates: {}
        };
        socket.emit('userData', user);
    });

    socket.on('distributeStat', (statName) => {
        if (!user || user.statPoints <= 0) return;
        if (statName === 'str' || statName === 'vit') {
            user[statName] += 1;
            user.statPoints -= 1;
            socket.emit('statUpdated', user);
        }
    });

    socket.on('equipItem', (data) => {
        if (!user || !user.inventory[data.itemIndex]) return;
        const item = user.inventory[data.itemIndex];
        const slot = item.type;

        if (user.equipped[slot]) {
            user.inventory.push(user.equipped[slot]);
        }

        user.equipped[slot] = item;
        user.inventory.splice(data.itemIndex, 1);
        socket.emit('statUpdated', user);
    });

    socket.on('unequipItem', (data) => {
        if (!user || !user.equipped[data.slot]) return;
        const item = user.equipped[data.slot];
        user.inventory.push(item);
        delete user.equipped[data.slot];
        socket.emit('statUpdated', user);
    });

    socket.on('doQuest', (data) => {
        if (!user) return;
        if (user.seferLimiti <= 0) {
            return socket.emit('questResult', { success: false, message: 'Sefer limitiniz doldu!', userData: user });
        }
        if (user.hp <= 0) {
            return socket.emit('questResult', { success: false, message: 'Canınız kalmadı! İksir içmelisiniz.', userData: user });
        }

        user.seferLimiti -= 1;

        const quests = {
            1: { gold: 45, exp: 20, hpLoss: 10, name: 'Karanlık Orman Bandidoları' },
            2: { gold: 120, exp: 55, hpLoss: 25, name: 'Unutulmuş Tapınak Harabeleri' },
            3: { gold: 300, exp: 140, hpLoss: 50, name: 'Ejderha Dağı Etekleri' }
        };

        const quest = quests[data.questId];
        if (!quest) return;

        user.balance += quest.gold;
        user.exp += quest.exp;
        user.hp = Math.max(0, user.hp - quest.hpLoss);

        const maxExp = user.level * 100;
        if (user.exp >= maxExp) {
            user.exp -= maxExp;
            user.level += 1;
            user.statPoints += 3;
        }

        socket.emit('questResult', {
            success: true,
            message: `${quest.name} seferi başarıyla tamamlandı!`,
            goldEarned: quest.gold,
            expEarned: quest.exp,
            hpLost: quest.hpLoss,
            userData: user
        });
    });

    socket.on('usePotion', () => {
        if (!user) return;
        if (user.balance < 50) {
            return socket.emit('questResult', { success: false, message: 'İksir için 50 altın gereklidir!', userData: user });
        }
        user.balance -= 50;
        const maxHp = user.vit * 20;
        user.hp = maxHp;
        socket.emit('questResult', { success: true, message: 'Can iksiri içildi, canınız tamamen doldu!', goldEarned: 0, expEarned: 0, hpLost: 0, userData: user });
    });

    // Mülk Satın Alma
    socket.on('buyEstate', (data) => {
        if (!user) return;
        const estateId = data.estateId;
        const estatesConfig = {
            1: { cost: 500, name: 'Küçük Buğday Çiftliği' },
            2: { cost: 2000, name: 'Üzüm Bağı ve Şaraphane' },
            3: { cost: 7500, name: 'Sınır Kalesi ve Ticaret Noktası' }
        };

        const estate = estatesConfig[estateId];
        if (!estate) return;

        if (!user.estates) user.estates = {};
        if (!user.estates[estateId]) {
            user.estates[estateId] = { count: 0, lastCollected: Date.now() };
        }

        if (user.balance >= estate.cost) {
            user.balance -= estate.cost;
            if (user.estates[estateId].count === 0) {
                user.estates[estateId].lastCollected = Date.now();
            }
            user.estates[estateId].count += 1;

            socket.emit('marketResult', {
                success: true,
                message: `${estate.name} başarıyla satın alındı!`,
                userData: user
            });
        } else {
            socket.emit('marketResult', {
                success: false,
                message: 'Yeterli altınınız yok!',
                userData: user
            });
        }
    });

    // Mülk Altınlarını Toplama (En az 1 saat geçme şartı)
    socket.on('collectEstateGold', (data) => {
        if (!user) return;
        const estateId = data.estateId;
        if (!user.estates || !user.estates[estateId] || user.estates[estateId].count <= 0) {
            return socket.emit('marketResult', { success: false, message: 'Bu mülke sahip değilsiniz.', userData: user });
        }

        const estateData = user.estates[estateId];
        const now = Date.now();
        const elapsedMinutes = (now - estateData.lastCollected) / (1000 * 60);

        if (elapsedMinutes < 60) {
            const remainingMinutes = Math.ceil(60 - elapsedMinutes);
            return socket.emit('marketResult', { 
                success: false, 
                message: `Altın toplamak için en az 1 saat geçmeli! Kalan süre: ${remainingMinutes} dakika.`, 
                userData: user 
            });
        }

        const incomeRates = { 1: 10, 2: 45, 3: 180 };
        const earnedGold = Math.floor(elapsedMinutes * incomeRates[estateId] * estateData.count);

        user.balance += earnedGold;
        estateData.lastCollected = now;

        socket.emit('marketResult', {
            success: true,
            message: `Mülklerden toplam ${earnedGold.toLocaleString('tr-TR')} altın toplandı!`,
            userData: user
        });
    });

    socket.on('upgradeItem', (data) => {
        if (!user) return;
        const itemType = data.itemType;
        if (!user.upgrades[itemType]) user.upgrades[itemType] = 0;
        const currentLevel = user.upgrades[itemType];
        const cost = (currentLevel + 1) * 100;

        if (user.balance >= cost) {
            user.balance -= cost;
            user.upgrades[itemType] += 1;
            socket.emit('forgeResult', {
                success: true,
                itemType: itemType,
                newLevel: user.upgrades[itemType],
                message: `${itemType.toUpperCase()} başarıyla +${user.upgrades[itemType]} seviyesine yükseltildi!`,
                userData: user
            });
        } else {
            socket.emit('forgeResult', { success: false, message: 'Yeterli altınınız yok!', userData: user });
        }
    });

    socket.on('sendChatMessage', (data) => {
        if (!user) return;
        io.emit('receiveChatMessage', { username: user.username, message: data.message });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});
