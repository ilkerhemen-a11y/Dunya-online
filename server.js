const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Statik dosyalar (public klasörü)
app.use(express.static('public'));

// MongoDB Bağlantısı (Kendi bağlantı adresini buraya yazabilirsin)
mongoose.connect('mongodb://localhost:27017/taht-savaslari', {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log("Veritabanına başarıyla bağlanıldı.");
}).catch(err => {
    console.error("Veritabanı bağlantı hatası:", err);
});

// Kullanıcı Şeması
const userSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    balance: { type: Number, default: 150 },
    rubies: { type: Number, default: 10 },
    level: { type: Number, default: 1 },
    exp: { type: Number, default: 0 },
    str: { type: Number, default: 10 },
    vit: { type: Number, default: 10 },
    statPoints: { type: Number, default: 0 },
    hp: { type: Number, default: 200 },
    seferLimiti: { type: Number, default: 20 },
    seferNextRefill: { type: Number, default: null },
    inventory: { type: Array, default: [] },
    equipped: {
        helmet: { type: Object, default: null },
        necklace: { type: Object, default: null },
        armor: { type: Object, default: null },
        weapon: { type: Object, default: null }
    },
    upgrades: {
        weapon: { type: Number, default: 0 },
        armor: { type: Number, default: 0 },
        helmet: { type: Number, default: 0 }
    }
});

const User = mongoose.model('User', userSchema);

// Aktif bağlantılar sözlüğü (Socket ID -> User ID)
const activeUsers = {};

// 30 Dakikalık Sefer Yenileme Arka Plan Döngüsü
setInterval(async () => {
    try {
        const now = Date.now();
        const usersToRefill = await User.find({ seferLimiti: { $lt: 20 } });

        for (let user of usersToRefill) {
            if (!user.seferNextRefill) {
                // Eğer zamanlayıcı başlatılmamışsa 30 dakika başlat
                user.seferNextRefill = now + (30 * 60 * 1000);
                await user.save();
            } else if (now >= user.seferNextRefill) {
                // Süre dolduyse 1 sefer hakkı ekle
                user.seferLimiti += 1;
                
                if (user.seferLimiti < 20) {
                    // Bir sonraki sefer için tekrar 30 dakika ekle
                    user.seferNextRefill = now + (30 * 60 * 1000);
                } else {
                    // Limit dolduysa zamanlayıcıyı sıfırla
                    user.seferLimiti = 20;
                    user.seferNextRefill = null;
                }
                await user.save();

                // Çevrimiçi olan kullanıcıya güncel veriyi ilet
                for (let [sId, uId] of Object.entries(activeUsers)) {
                    if (uId === user._id.toString()) {
                        io.to(sId).emit('userData', user);
                    }
                }
            }
        }
    } catch (err) {
        console.error("Sefer yenileme döngü hatası:", err);
    }
}, 1000);

// Socket.io Bağlantıları
io.on('connection', (socket) => {
    console.log('Bir oyuncu bağlandı:', socket.id);

    // Kayıt Olma
    socket.on('userRegister', async (data) => {
        try {
            const existing = await User.findOne({ username: data.username });
            if (existing) {
                return socket.emit('authResult', { success: false, message: 'Bu gladyatör adı zaten alınmış.' });
            }
            const hashedPassword = await bcrypt.hash(data.password, 10);
            const newUser = new User({
                username: data.username,
                password: hashedPassword,
                hp: 200
            });
            await newUser.save();
            socket.emit('authResult', { success: true, message: 'Kayıt başarılı! Giriş yapabilirsiniz.' });
        } catch (err) {
            socket.emit('authResult', { success: false, message: 'Kayıt olurken bir hata oluştu.' });
        }
    });

    // Giriş Yapma
    socket.on('userLogin', async (data) => {
        try {
            const user = await User.findOne({ username: data.username });
            if (!user || !(await bcrypt.compare(data.password, user.password))) {
                return socket.emit('authResult', { success: false, message: 'Geçersiz gladyatör adı veya şifre.' });
            }
            activeUsers[socket.id] = user._id.toString();
            socket.emit('userData', user);
        } catch (err) {
            socket.emit('authResult', { success: false, message: 'Giriş yapılırken bir hata oluştu.' });
        }
    });

    // Sefer / Görev Yapma (doQuest)
    socket.on('doQuest', async (data) => {
        try {
            const userId = activeUsers[socket.id];
            if (!userId) return;
            const user = await User.findById(userId);
            if (!user || user.seferLimiti <= 0 || user.hp <= 0) {
                return socket.emit('questResult', { success: false, message: 'Sefer hakkınız kalmadı veya canınız tükenmiş!' });
            }

            let goldReward = 0;
            let expReward = 0;
            let hpCost = 0;

            if (data.questId === 1) { goldReward = 45; expReward = 20; hpCost = 15; }
            else if (data.questId === 2) { goldReward = 120; expReward = 55; hpCost = 35; }
            else if (data.questId === 3) { goldReward = 300; expReward = 140; hpCost = 70; }

            // Sefer limiti düşüşü ve timer başlatma kontrolü
            if (user.seferLimiti === 20 && !user.seferNextRefill) {
                user.seferNextRefill = Date.now() + (30 * 60 * 1000); // İlk hak harcandığında 30 dk başlat
            }
            user.seferLimiti -= 1;
            user.balance += goldReward;
            user.exp += expReward;
            user.hp = Math.max(0, user.hp - hpCost);

            // Seviye Atlama Kontrolü
            const maxExp = user.level * 100;
            if (user.exp >= maxExp) {
                user.exp -= maxExp;
                user.level += 1;
                user.statPoints += 3;
            }

            await user.save();
            socket.emit('questResult', {
                success: true,
                message: 'Sefer başarıyla tamamlandı!',
                goldEarned: goldReward,
                expEarned: expReward,
                userData: user
            });
        } catch (err) {
            console.error(err);
        }
    });

    // İstatistik Dağıtma
    socket.on('distributeStat', async (statName) => {
        try {
            const userId = activeUsers[socket.id];
            if (!userId) return;
            const user = await User.findById(userId);
            if (user && user.statPoints > 0) {
                if (statName === 'str') user.str += 1;
                if (statName === 'vit') {
                    user.vit += 1;
                    user.hp = user.vit * 20; // Canı yenile/güncelle
                }
                user.statPoints -= 1;
                await user.save();
                socket.emit('userData', user);
            }
        } catch (err) {
            console.error(err);
        }
    });

    // Sohbet Mesajı
    socket.on('sendChatMessage', (data) => {
        const userId = activeUsers[socket.id];
        if (!userId) return;
        User.findById(userId).then(user => {
            if (user) {
                io.emit('receiveChatMessage', { username: user.username, message: data.message });
            }
        });
    });

    // Çıkış Yapma
    socket.on('logout', () => {
        delete activeUsers[socket.id];
        socket.emit('logoutSuccess');
    });

    socket.on('disconnect', () => {
        delete activeUsers[socket.id];
        console.log('Bir oyuncu ayrıldı:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor.`);
});
