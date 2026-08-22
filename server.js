const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(__dirname + '/public'));

// 1. MongoDB Bağlantısı
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/throne_war';
mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB bağlantısı başarılı!'))
    .catch(err => console.error('MongoDB bağlantı hatası:', err));

// Kullanıcı Şeması
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
    estates: { type: [Number], default: [] },
    upgrades: { type: Object, default: { weapon: 0, armor: 0, helmet: 0 } },
    equipped: { type: Object, default: {} },
    inventory: { type: Array, default: [] }
});

const User = mongoose.model('User', userSchema);
const users = {}; // Bellekte aktif kullanıcılar

io.on('connection', (socket) => {
    console.log('Yeni bağlantı:', socket.id);

    // Kayıt
    socket.on('userRegister', async (data) => {
        try {
            const hashedPassword = await bcrypt.hash(data.password, 10);
            const newUser = new User({ username: data.username, password: hashedPassword });
            await newUser.save();
            socket.emit('authResult', { success: true, message: "Kayıt başarılı!" });
        } catch (err) {
            socket.emit('authResult', { success: false, message: "Kayıt başarısız, isim kullanımda olabilir." });
        }
    });

    // Giriş
    socket.on('userLogin', async (data) => {
        const dbUser = await User.findOne({ username: data.username });
        if (dbUser && await bcrypt.compare(data.password, dbUser.password)) {
            users[socket.id] = dbUser; // Kullanıcıyı belleğe al
            socket.emit('userData', dbUser);
        } else {
            socket.emit('authResult', { success: false, message: "Hatalı giriş bilgileri!" });
        }
    });

    // Görev (Örnek)
    socket.on('doQuest', async (data) => {
        const user = users[socket.id];
        if (!user) return;
        
        // Mantık: Altın ve Exp ekle
        user.balance += 50;
        user.exp += 20;
        await user.save(); // Veritabanına işle
        
        socket.emit('statUpdated', user); // Güncel veriyi istemciye gönder
    });

    // Çıkış ve Disconnect
    const handleDisconnect = async () => {
        if (users[socket.id]) {
            await users[socket.id].save(); // Çıkarken veritabanına kaydet
            delete users[socket.id];
            console.log('Kullanıcı kaydedildi ve bağlantı kesildi.');
        }
    };

    socket.on('logout', async () => {
        await handleDisconnect();
        socket.emit('logoutSuccess');
    });

    socket.on('disconnect', handleDisconnect);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Sunucu aktif: http://localhost:${PORT}`));
