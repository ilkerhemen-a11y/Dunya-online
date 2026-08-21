const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Statik dosyaları dışarı aç
app.use(express.static(__dirname));

// Kök dizine (/) girildiğinde index.html'i gönder
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

const users = {};

io.on('connection', (socket) => {
    console.log(`Bir oyuncu bağlandı: ${socket.id}`);

    socket.on('userLogin', (data) => {
        const username = data.username || 'Gezgin';
        
        if (!users[socket.id]) {
            users[socket.id] = {
                username: username,
                level: 1,
                balance: 1000,
                str: 5,
                int: 5,
                dex: 5,
                vit: 5,
                statPoints: 0,
                upgrades: { weapon: 0, armor: 0, helmet: 0 },
                estates: []
            };
        }

        socket.emit('userData', users[socket.id]);
    });

    socket.on('doQuest', (data) => {
        const user = users[socket.id];
        if (!user) return;

        let goldReward = 45;
        let expReward = 20;

        if (data.questId === 2) { goldReward = 120; expReward = 55; }
        if (data.questId === 3) { goldReward = 300; expReward = 140; }

        user.balance += goldReward;

        socket.emit('questResult', {
            userData: user,
            message: "Sefer başarıyla tamamlandı, ganimetler kasaya aktarıldı!",
            goldEarned: goldReward,
            expEarned: expReward
        });
    });

    socket.on('buyEstate', (data) => {
        const user = users[socket.id];
        if (!user) return;

        let cost = 500;
        let estateName = "Küçük Buğday Çiftliği";

        if (data.estateId === 2) { cost = 2000; estateName = "Üzüm Bağı ve Şaraphane"; }
        if (data.estateId === 3) { cost = 7500; estateName = "Sınır Kalesi"; }

        if (user.balance >= cost) {
            user.balance -= cost;
            user.estates.push(data.estateId);

            socket.emit('marketResult', {
                userData: user,
                message: `Tebrikler! ${estateName} satın alındı.`
            });
        } else {
            socket.emit('marketResult', {
                userData: user,
                message: "Yeterli altınınız yok, lordum!"
            });
        }
    });

    socket.on('upgradeItem', (data) => {
        const user = users[socket.id];
        if (!user) return;

        const itemType = data.itemType; 
        if (!user.upgrades) user.upgrades = { weapon: 0, armor: 0, helmet: 0 };

        const currentLevel = user.upgrades[itemType] || 0;
        const cost = (currentLevel + 1) * 100;

        if (user.balance >= cost) {
            user.balance -= cost;
            user.upgrades[itemType] += 1;

            socket.emit('forgeResult', {
                userData: user,
                itemType: itemType,
                newLevel: user.upgrades[itemType],
                message: `Başarıyla +${user.upgrades[itemType]} seviyesine yükseltildi!`
            });
        } else {
            socket.emit('forgeResult', {
                userData: user,
                itemType: itemType,
                newLevel: currentLevel,
                message: "Yükseltme için yeterli altınınız yok!"
            });
        }
    });

    socket.on('sendChatMessage', (data) => {
        const user = users[socket.id];
        if (!user) return;

        io.emit('receiveChatMessage', {
            username: user.username,
            message: data.message
        });
    });

    socket.on('disconnect', () => {
        console.log(`Oyuncu ayrıldı: ${socket.id}`);
        delete users[socket.id];
    });
});

server.listen(3000, () => {
    console.log('Sunucu 3000 portunda çalışıyor, lordum!');
});
