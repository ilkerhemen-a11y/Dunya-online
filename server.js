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
            balance: 1000
        };

        socket.emit('loginSuccess', onlineUsers[socket.id]);
        io.emit('updateUserList', Object.values(onlineUsers));
        io.emit('systemMessage', `${username} odaya katıldı.`);
    });

    socket.on('sendMessage', (msg) => {
        const user = onlineUsers[socket.id];
        if (user && msg && msg.trim() !== '') {
            io.emit('chatMessage', { user: user.username, text: msg });
        }
    });

    socket.on('buyItem', (item) => {
        const user = onlineUsers[socket.id];
        if (user && user.balance >= item.price) {
            user.balance -= item.price;
            socket.emit('updateBalance', user.balance);
            io.emit('systemMessage', `🎉 ${user.username}, [${item.name}] satın aldı!`);
        }
    });

    // --- MİNİ OYUN MEKANİKLERİ ---
    
    // 1. Maden Kazma (Clicker)
    socket.on('mineGold', () => {
        const user = onlineUsers[socket.id];
        if (user) {
            const reward = Math.floor(Math.random() * 20) + 10; // 10-30 ₺ arası rastgele bakiye
            user.balance += reward;
            socket.emit('updateBalance', user.balance);
            socket.emit('gameLog', `⛏️ Madenden ${reward} ₺ çıkardın!`);
        }
    });

    // 2. Zar Atma (Şans Oyunu - 100 ₺ Bahis)
    socket.on('rollDice', () => {
        const user = onlineUsers[socket.id];
        const bet = 100;
        if (user && user.balance >= bet) {
            user.balance -= bet;
            const dice = Math.floor(Math.random() * 6) + 1;
            
            if (dice >= 4) { // 4, 5, 6 gelirse kazanır (2 katı)
                const win = bet * 2;
                user.balance += win;
                socket.emit('updateBalance', user.balance);
                socket.emit('gameLog', `🎲 Zar: ${dice}! Kazandın: +${win} ₺`);
                io.emit('systemMessage', `🎲 ${user.username} zardan ${win} ₺ kazandı!`);
            } else { // 1, 2, 3 gelirse kaybeder
                socket.emit('updateBalance', user.balance);
                socket.emit('gameLog', `🎲 Zar: ${dice}! Kaybettin: -${bet} ₺`);
            }
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
