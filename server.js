const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname + '/public'));

const users = {};

const getDefaultInventory = () => [
    { id: 'item_1', name: 'Tahta Kılıç', icon: '🗡️', type: 'weapon', strBonus: 3, vitBonus: 0 },
    { id: 'item_2', name: 'Deri Zırh', icon: '🛡️', type: 'armor', strBonus: 0, vitBonus: 5 },
    { id: 'item_3', name: 'Bakır Kolye', icon: '📿', type: 'necklace', strBonus: 1, vitBonus: 2 }
];

io.on('connection', (socket) => {
    console.log('Yeni bir gladyatör bağlandı:', socket.id);

    // Giriş Yapma
    socket.on('userLogin', (data) => {
        const username = data.username ? data.username.trim() : 'Gladyatör';
        
        users[socket.id] = {
            id: socket.id,
            username: username,
            level: 1,
            exp: 0,
            balance: 100,
            rubies: 10,
            str: 5,
            vit: 5,
            statPoints: 0,
            hp: 100,                 // Mevcut Can
            seferLimiti: 20,         // Sefer Sayısı
            seferNextRefill: null,   // Süre Zamanlayıcısı
            upgrades: { weapon: 0, armor: 0, helmet: 0 },
            equipped: {
                helmet: null,
                necklace: null,
                armor: null,
                weapon: null,
                shield: null,
                ring: null,
                gloves: null,
                boots: null
            },
            inventory: getDefaultInventory()
        };

        socket.emit('userData', users[socket.id]);
    });

    // Eşya Kuşanma
    socket.on('equipItem', (data) => {
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
        socket.emit('statUpdated', user);
    });

    // Eşya Çıkarma
    socket.on('unequipItem', (data) => {
        const user = users[socket.id];
        if (!user) return;

        const { slot } = data;
        if (!slot || !user.equipped[slot]) return;

        const unequippedItem = user.equipped[slot];
        user.equipped[slot] = null;
        user.inventory.push(unequippedItem);

        socket.emit('statUpdated', user);
    });

    // Sefer / Görev Yapma
    socket.on('doQuest', (data) => {
        const user = users[socket.id];
        if (!user) return;

        const now = Date.now();
        const COOLDOWN_TIME = 60 * 60 * 1000; // 1 Saat

        // Zamanlayıcı süresi dolduysa sefer hakkını yenile ve süreyi sıfırla
        if (user.seferNextRefill && now >= user.seferNextRefill) {
            user.seferLimiti = 20;
            user.seferNextRefill = null;
        }

        // Can Kontrolü
        if (user.hp <= 0) {
            return socket.emit('questResult', {
                success: false,
                message: "Canınız (HP) tükenmiş! Sefer düzenlemek için can iksiri içmelisiniz.",
                userData: user
            });
        }

        // Sefer Hak Kontrolü
        if (user.seferLimiti <= 0) {
            return socket.emit('questResult', {
                success: false,
                message: "Sefer limitiniz dolmuştur! Yenilenmesi için geri sayımın tamamlanmasını bekleyin.",
                userData: user
            });
        }

        // Limit düşür ve ilk kullanımda geri sayımı başlat
        user.seferLimiti -= 1;
        if (!user.seferNextRefill) {
            user.seferNextRefill = now + COOLDOWN_TIME;
        }

        // Dövüş Hesaplaması (Can Düşüşü)
        const questId = data.questId || 1;
        const hpLost = Math.floor(Math.random() * (questId * 12)) + 5;
        user.hp = Math.max(0, user.hp - hpLost);

        // Ödül Hesaplama
        const goldEarned = questId * 45 + Math.floor(Math.random() * 15);
        const expEarned = questId * 25;

        user.balance += goldEarned;
        user.exp += expEarned;

        // Seviye Atlama (Level Up)
        const maxExp = user.level * 100;
        if (user.exp >= maxExp) {
            user.level += 1;
            user.exp -= maxExp;
            user.statPoints += 3;
        }

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
    socket.on('distributeStat', (statName) => {
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

        socket.emit('statUpdated', user);
    });

    // Can İksiri İçme (Yalnızca Canı Yeniler, Sefe Haklarına ve Süreye Dokunmaz)
    socket.on('usePotion', () => {
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
        user.hp = user.vit * 20; // Yalnızca can tamamen yenilenir

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
    socket.on('upgradeItem', (data) => {
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
