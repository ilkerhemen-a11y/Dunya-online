const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname + '/public')); // index.html dosyanız public klasöründeyse

// Bellekte tutulan oyuncu verileri
const users = {};

io.on('connection', (socket) => {
    console.log('Yeni bir gladyatör bağlandı:', socket.id);

    // Giriş Yapma / Oyuncu Oluşturma
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
            hp: 100,
            seferLimiti: 20,         // Sefer sınırı (Max 20)
            seferNextRefill: null,   // Yenilenme süresi (Timestamp)
            upgrades: { weapon: 0, armor: 0, helmet: 0 },
            equipped: {},
            inventory: [
                { name: 'Tahta Kılıç', icon: '🗡️', type: 'weapon', strBonus: 2, vitBonus: 0 }
            ]
        };

        socket.emit('userData', users[socket.id]);
    });

    // Sefer / Görev Yapma
    socket.on('doQuest', (data) => {
        const user = users[socket.id];
        if (!user) return;

        const now = Date.now();
        const COOLDOWN_TIME = 60 * 60 * 1000; // 1 Saat (Milisaniye)

        // 1 Saat dolduysa sefer limitini otomatik sıfırla
        if (user.seferNextRefill && now >= user.seferNextRefill) {
            user.seferLimiti = 20;
            user.seferNextRefill = null;
        }

        // Limit kontrolü
        if (user.seferLimiti <= 0) {
            return socket.emit('questResult', {
                success: false,
                message: "Sefer limitiniz dolmuştur! Yenilenmesi için sürenin bitmesini bekleyin.",
                userData: user
            });
        }

        // Limit düşür ve gerekirse geri sayımı başlat
        user.seferLimiti -= 1;
        if (!user.seferNextRefill) {
            user.seferNextRefill = now + COOLDOWN_TIME;
        }

        // Kazanç Hesaplama
        const questId = data.questId || 1;
        const goldEarned = questId * 45 + Math.floor(Math.random() * 15);
        const expEarned = questId * 25;

        user.balance += goldEarned;
        user.exp += expEarned;

        // Seviye Atlama (Level Up) Kontrolü
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
            userData: user
        });
    });

    // Nitelik (Stat) Dağıtma
    socket.on('distributeStat', (statName) => {
        const user = users[socket.id];
        if (!user || user.statPoints <= 0) return;

        if (statName === 'str') {
            user.str += 1;
            user.statPoints -= 1;
        } else if (statName === 'vit') {
            user.vit += 1;
            user.statPoints -= 1;
            user.hp = user.vit * 20; // Canı güncelle
        }

        socket.emit('statUpdated', user);
    });

    // İksir İçme (Sefer / Can Yenileme)
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
        user.seferLimiti = 20;
        user.seferNextRefill = null;

        socket.emit('questResult', {
            success: true,
            message: "İksir içildi! Sefer limitiniz tamamen yenilendi.",
            goldEarned: 0,
            expEarned: 0,
            userData: user
        });
    });

    // Demirhane (+ Basma)
    socket.on('upgradeItem', (data) => {
        const user = users[socket.id];
        if (!user) return;

        const itemType = data.itemType; // 'weapon', 'armor', 'helmet'
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

    // Sohbet Mesajı Gönderme
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
    console.log(`Sunucu http://localhost:${PORT} üzerinde çalışıyor.`);
});
