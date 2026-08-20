const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
const mongoose = require('mongoose');

// MongoDB Bağlantısı
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB Veritabanına Başarıyla Bağlanıldı!'))
  .catch(err => console.error('MongoDB Bağlantı Hatası:', err));
// --- MONGODB BAĞLANTISI VE MODELİ ---
const MONGO_URI = process.env.MONGO_URI || "SENIN_MONGODB_URI_KODUN";

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Veritabanına Bağlanıldı'))
    .catch(err => console.error('❌ MongoDB Bağlantı Hatası:', err));

const userSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    balance: { type: Number, default: 1000 },
    level: { type: Number, default: 1 },
    xp: { type: Number, default: 0 },
    isVip: { type: Boolean, default: false },
    hasSpeed: { type: Boolean, default: false },
    lastGift: { type: Number, default: 0 }
});

const User = mongoose.model('User', userSchema);

const onlineUsers = {};
const activeDuels = {};

// Kullanıcıyı veritabanında güncelleme yardımcı fonksiyonu
async function saveUserData(user) {
    if (!user || !user.dbId) return;
    await User.findByIdAndUpdate(user.dbId, {
        balance: user.balance,
        level: user.level,
        xp: user.xp,
        isVip: user.isVip,
        hasSpeed: user.hasSpeed,
        lastGift: user.lastGift
    });
}

io.on('connection', (socket) => {

    socket.on('userLogin', async (data) => {
        let username = (data && data.username && data.username.trim()) 
            ? data.username.trim() 
            : `Ziyaretçi_${Math.floor(1000 + Math.random() * 9000)}`;

        try {
            // Veritabanında kullanıcı var mı kontrol et, yoksa oluştur
            let dbUser = await User.findOne({ username: username });
            if (!dbUser) {
                dbUser = await User.create({ username: username });
            }

            onlineUsers[socket.id] = {
                id: socket.id,
                dbId: dbUser._id,
                username: dbUser.username,
                balance: dbUser.balance,
                level: dbUser.level,
                xp: dbUser.xp,
                isVip: dbUser.isVip,
                hasSpeed: dbUser.hasSpeed,
                lastGift: dbUser.lastGift
            };

            socket.emit('loginSuccess', onlineUsers[socket.id]);
            io.emit('updateUserList', Object.values(onlineUsers));
            io.emit('systemMessage', `${username} odaya katıldı.`);
        } catch (err) {
            console.error('Giriş Hatası:', err);
        }
    });

    socket.on('sendMessage', (msg) => {
        const user = onlineUsers[socket.id];
        if (user && msg && msg.trim() !== '') {
            io.emit('chatMessage', { user: user.username, text: msg, isVip: user.isVip });
        }
    });

    socket.on('buyItem', async (item) => {
        const user = onlineUsers[socket.id];
        if (user && user.balance >= item.price) {
            user.balance -= item.price;
            if (item.name === 'VIP Üyelik') user.isVip = true;
            else if (item.name === 'Hız Takviyesi') user.hasSpeed = true;

            await saveUserData(user);

            socket.emit('updateBalance', user.balance);
            socket.emit('updateProfile', user);
            io.emit('updateUserList', Object.values(onlineUsers));
            io.emit('systemMessage', `🎉 ${user.username}, [${item.name}] satın aldı!`);
        }
    });

    socket.on('mineGold', async () => {
        const user = onlineUsers[socket.id];
        if (user) {
            const reward = Math.floor(Math.random() * 20) + 10;
            user.balance += reward;
            const xpGain = user.hasSpeed ? 20 : 10;
            user.xp += xpGain;
            
            const nextLevelXp = user.level * 100;
            if (user.xp >= nextLevelXp) {
                user.level++;
                user.xp -= nextLevelXp;
                io.emit('systemMessage', `🌟 ${user.username} Seviye ${user.level} oldu!`);
            }

            await saveUserData(user);

            socket.emit('updateBalance', user.balance);
            socket.emit('updateProfile', user);
            socket.emit('gameLog', `⛏️ Madenden ${reward} ₺ ve +${xpGain} XP kazandın!`);
        }
    });

    socket.on('rollDice', async () => {
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
                socket.emit('gameLog', `🎲 Zar: ${dice}! Kazandın: +${win} ₺ (+15 XP)`);
                io.emit('systemMessage', `🎲 ${user.username} zardan ${win} ₺ kazandı!`);
            } else {
                socket.emit('gameLog', `🎲 Zar: ${dice}! Kaybettin: -${bet} ₺ (+15 XP)`);
            }

            await saveUserData(user);

            socket.emit('updateBalance', user.balance);
            socket.emit('updateProfile', user);
        } else if (user) {
            socket.emit('gameLog', `⚠️ Zar atmak için en az ${bet} ₺ gerekli!`);
        }
    });

    socket.on('openGift', async () => {
        const user = onlineUsers[socket.id];
        if (!user) return;

        const cooldown = 3 * 60 * 1000;
        const now = Date.now();
        const diff = now - (user.lastGift || 0);

        if (diff < cooldown) {
            const remSec = Math.ceil((cooldown - diff) / 1000);
            socket.emit('gameLog', `⏳ Şans kutusu için ${remSec} saniye beklemelisin!`);
            return;
        }

        user.lastGift = now;
        const rewardGold = Math.floor(Math.random() * 150) + 50;
        const rewardXp = 50;
        
        user.balance += rewardGold;
        user.xp += rewardXp;

        const nextLevelXp = user.level * 100;
        if (user.xp >= nextLevelXp) {
            user.level++;
            user.xp -= nextLevelXp;
            io.emit('systemMessage', `🌟 ${user.username} Seviye ${user.level} oldu!`);
        }

        await saveUserData(user);

        socket.emit('updateBalance', user.balance);
        socket.emit('updateProfile', user);
        socket.emit('gameLog', `🎁 Şans Kutusu Açıldı! +${rewardGold} ₺ ve +${rewardXp} XP kazandın!`);
    });

    socket.on('transferMoney', async (data) => {
        const sender = onlineUsers[socket.id];
        const target = onlineUsers[data.targetId];
        const amount = parseInt(data.amount);

        if (!sender || !target) return socket.emit('gameLog', '⚠️ Kullanıcı bulunamadı!');
        if (sender.id === target.id) return socket.emit('gameLog', '⚠️ Kendine para gönderemezsin!');
        if (isNaN(amount) || amount <= 0) return socket.emit('gameLog', '⚠️ Geçersiz miktar!');
        if (sender.balance < amount) return socket.emit('gameLog', '⚠️ Yetersiz bakiye!');

        sender.balance -= amount;
        target.balance += amount;

        await saveUserData(sender);
        await saveUserData(target);

        socket.emit('updateBalance', sender.balance);
        socket.emit('updateProfile', sender);
        socket.emit('gameLog', `💸 ${target.username} kullanıcısına ${amount} ₺ gönderdin.`);

        io.to(target.id).emit('updateBalance', target.balance);
        io.to(target.id).emit('updateProfile', target);
        io.to(target.id).emit('gameLog', `💰 ${sender.username} sana ${amount} ₺ gönderdi!`);
        
        io.emit('systemMessage', `💸 ${sender.username} ➔ ${target.username} (${amount} ₺ transfer etti)`);
    });

    socket.on('sendDuelInvite', (data) => {
        const sender = onlineUsers[socket.id];
        const target = onlineUsers[data.targetId];
        const bet = parseInt(data.bet) || 100;

        if (!sender || !target) return socket.emit('gameLog', '⚠️ Oyuncu bulunamadı!');
        if (sender.id === target.id) return socket.emit('gameLog', '⚠️ Kendine meydan okuyamazsın!');
        if (sender.balance < bet) return socket.emit('gameLog', `⚠️ En az ${bet} ₺ bakiyen olmalı!`);
        if (target.balance < bet) return socket.emit('gameLog', `⚠️ Karşı tarafın yeterli bakiyesi yok! (${bet} ₺)`);

        const duelId = `duel_${Date.now()}`;
        activeDuels[duelId] = {
            id: duelId,
            challengerId: sender.id,
            targetId: target.id,
            bet: bet,
            choices: {},
            status: 'pending'
        };

        io.to(target.id).emit('duelInviteReceived', {
            duelId: duelId,
            from: sender.username,
            bet: bet
        });

        socket.emit('gameLog', `⚔️ ${target.username} oyuncusuna ${bet} ₺ tutarında düello teklifi gönderildi!`);
    });

    socket.on('respondDuel', async (data) => {
        const duel = activeDuels[data.duelId];
        if (!duel || duel.status !== 'pending') return;

        const challenger = onlineUsers[duel.challengerId];
        const target = onlineUsers[duel.targetId];

        if (!challenger || !target) {
            delete activeDuels[data.duelId];
            return;
        }

        if (!data.accept) {
            io.to(challenger.id).emit('gameLog', `❌ ${target.username} düello teklifini reddetti.`);
            delete activeDuels[data.duelId];
            return;
        }

        if (challenger.balance < duel.bet || target.balance < duel.bet) {
            io.to(challenger.id).emit('gameLog', '⚠️ Yetersiz bakiye nedeniyle düello iptal edildi.');
            io.to(target.id).emit('gameLog', '⚠️ Yetersiz bakiye nedeniyle düello iptal edildi.');
            delete activeDuels[data.duelId];
            return;
        }

        challenger.balance -= duel.bet;
        target.balance -= duel.bet;

        await saveUserData(challenger);
        await saveUserData(target);

        socket.emit('updateBalance', target.balance);
        socket.emit('updateProfile', target);
        io.to(challenger.id).emit('updateBalance', challenger.balance);
        io.to(challenger.id).emit('updateProfile', challenger);

        duel.status = 'playing';

        io.to(challenger.id).emit('startDuelUI', { duelId: duel.id, opponent: target.username, bet: duel.bet });
        io.to(target.id).emit('startDuelUI', { duelId: duel.id, opponent: challenger.username, bet: duel.bet });
    });

    socket.on('makeDuelChoice', async (data) => {
        const duel = activeDuels[data.duelId];
        if (!duel || duel.status !== 'playing') return;

        duel.choices[socket.id] = data.choice;

        if (duel.choices[duel.challengerId] && duel.choices[duel.targetId]) {
            const p1 = duel.challengerId;
            const p2 = duel.targetId;
            const c1 = duel.choices[p1];
            const c2 = duel.choices[p2];

            const u1 = onlineUsers[p1];
            const u2 = onlineUsers[p2];

            let winner = null;
            if (c1 === c2) winner = null;
            else if (
                (c1 === 'rock' && c2 === 'scissors') ||
                (c1 === 'scissors' && c2 === 'paper') ||
                (c1 === 'paper' && c2 === 'rock')
            ) winner = p1;
            else winner = p2;

            if (winner === null) {
                if (u1) u1.balance += duel.bet;
                if (u2) u2.balance += duel.bet;

                io.to(p1).emit('duelFinished', { result: 'draw', msg: `Berabere! Seçimler: ${c1} vs ${c2}. Bahisler iade edildi.` });
                io.to(p2).emit('duelFinished', { result: 'draw', msg: `Berabere! Seçimler: ${c2} vs ${c1}. Bahisler iade edildi.` });
            } else {
                const winUser = onlineUsers[winner];
                const loseId = winner === p1 ? p2 : p1;
                const winChoice = winner === p1 ? c1 : c2;
                const loseChoice = winner === p1 ? c2 : c1;
                const totalPrize = duel.bet * 2;

                if (winUser) {
                    winUser.balance += totalPrize;
                    winUser.xp += 25;
                }

                io.to(winner).emit('duelFinished', { result: 'win', msg: `🎉 Kazandın! (${winChoice} vs ${loseChoice}) +${totalPrize} ₺ kazandın!` });
                io.to(loseId).emit('duelFinished', { result: 'lose', msg: `💀 Kaybettin! (${loseChoice} vs ${winChoice})` });
                io.emit('systemMessage', `⚔️ Düello sonucu: ${winUser ? winUser.username : 'Oyuncu'} ${totalPrize} ₺ kazandı!`);
            }

            if (u1) await saveUserData(u1);
            if (u2) await saveUserData(u2);

            if (u1) { io.to(p1).emit('updateBalance', u1.balance); io.to(p1).emit('updateProfile', u1); }
            if (u2) { io.to(p2).emit('updateBalance', u2.balance); io.to(p2).emit('updateProfile', u2); }

            delete activeDuels[data.duelId];
        } else {
            socket.emit('gameLog', '⏳ Hamleni yaptın, rakibin hamlesi bekleniyor...');
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
