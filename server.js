const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const onlineUsers = {};

io.on('connection', (socket) => {
    socket.on('userLogin', (data) => {
        const username = (data && data.username && data.username.trim()) 
            ? data.username.trim() 
            : `Ziyaretçi_${Math.floor(1000 + Math.random() * 9000)}`;
            
        onlineUsers[socket.id] = {
            id: socket.id,
            username: username,
            balance: 1000,
            level: 1,
            xp: 0,
            isVip: false,
            hasSpeed: false
        };

        socket.emit('loginSuccess', onlineUsers[socket.id]);
        io.emit('updateUserList', Object.values(onlineUsers));
        io.emit('systemMessage', `${username} odaya katıldı.`);
    });

    socket.on('sendMessage', (msg) => {
        const user = onlineUsers[socket.id];
        if (user && msg && msg.trim() !== '') {
            io.emit('chatMessage', { user: user.username, text: msg, isVip: user.isVip });
        }
    });

    socket.on('buyItem', (item) => {
        const user = onlineUsers[socket.id];
        if (user && user.balance >= item.price) {
            user.balance -= item.price;
            
            if (item.name === 'VIP Üyelik') {
                user.isVip = true;
            } else if (item.name === 'Hız Takviyesi') {
                user.hasSpeed = true;
            }

            socket.emit('updateBalance', user.balance);
            socket.emit('updateProfile', user);
            io.emit('updateUserList', Object.values(onlineUsers));
            io.emit('systemMessage', `🎉 ${user.username}, [${item.name}] satın aldı!`);
        }
    });

    // Maden Kazma (Clicker + XP Mantığı)
    socket.on('mineGold', () => {
        const user = onlineUsers[socket.id];
        if (user) {
            const reward = Math.floor(Math.random() * 20) + 10;
            user.balance += reward;
            
            const xpGain = user.hasSpeed ? 20 : 10; // Hız takviyesi olan daha çok XP kazanır
            user.xp += xpGain;
            
            const nextLevelXp = user.level * 100;
            if (user.xp >= nextLevelXp) {
                user.level++;
                user.xp -= nextLevelXp;
                io.emit('systemMessage', `🌟 ${user.username} Seviye ${user.level} oldu!`);
            }

            socket.emit('updateBalance', user.balance);
            socket.emit('updateProfile', user);
            socket.emit('gameLog', `⛏️ Madenden ${reward} ₺ ve +${xpGain} XP kazandın!`);
        }
    });

    // Zar Atma (Şans Oyunu + XP Mantığı)
    socket.on('rollDice', () => {
        const user = onlineUsers[socket.id];
        const bet = 100;
        if (user && user.balance >= bet) {
            user.balance -= bet;
            const dice = Math.floor(Math.random() * 6) + 1;
            
            user.xp += 15;
            const nextLevelXp = user.level * 100;
            if (user.xp >= nextLevelXp) {
                user.level++;
                user.xp -= nextLevelXp;
                io.emit('systemMessage', `🌟 ${user.username} Seviye ${user.level} oldu!`);
            }

            if (dice >= 4) {
                const win = bet * 2;
                user.balance += win;
                socket.emit('updateBalance', user.balance);
                socket.emit('gameLog', `🎲 Zar: ${dice}! Kazandın: +${win} ₺ (+15 XP)`);
                io.emit('systemMessage', `🎲 ${user.username} zardan ${win} ₺ kazandı!`);
            } else {
                socket.emit('updateBalance', user.balance);
                socket.emit('gameLog', `🎲 Zar: ${dice}! Kaybettin: -${bet} ₺ (+15 XP)`);
            }
            socket.emit('updateProfile', user);
        } else if (user) {
            socket.emit('gameLog', `⚠️ Zar atmak için en az ${bet} ₺ gerekli!`);
        }
    });

    socket.on('disconnect', () => {
        if (onlineUsers[socket.id]) {
            const username = onlineUsers[socket.id].username;
            delete onlineUsers[socket.id];
            io.emit('updateUserList', Object.values(onlineUsers));
            io.emit('systemMessage', `${username} ayrıldı.`);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Sunucu aktif: ${PORT}`));
