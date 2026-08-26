const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Statik dosyaları sunma
app.use(express.static(__dirname));

// MongoDB Bağlantısı (Render MONGO_URI öncelikli, yerel için fallback)
const dbURI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/taht-savasi";

mongoose.connect(dbURI)
  .then(() => console.log("MongoDB Bağlantısı Başarılı!"))
  .catch(err => console.error("DB Bağlantı Hatası:", err));

// Kullanıcı Şeması
const userSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    level: { type: Number, default: 1 },
    exp: { type: Number, default: 0 },
    balance: { type: Number, default: 200 },
    rubies: { type: Number, default: 10 },
    hp: { type: Number, default: 100 },
    str: { type: Number, default: 5 },
    vit: { type: Number, default: 5 },
    statPoints: { type: Number, default: 0 },
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
    inventory: { type: Array, default: [
        { id: 1, name: "Paslı Kılıç", icon: "🗡️", type: "weapon", strBonus: 3, vitBonus: 0 },
        { id: 2, name: "Deri Zırh", icon: "🛡️", type: "armor", strBonus: 1, vitBonus: 4 }
    ]}
});

const User = mongoose.model('User', userSchema);

// Socket.io Bağlantı Yönetimi
io.on('connection', (socket) => {
    console.log(`Bir gezgin bağlandı: ${socket.id}`);
    let loggedInUser = null;

    // Kayıt Olma
    socket.on('userRegister', async (data) => {
        try {
            if (!data.username || !data.password) {
                return socket.emit('authResult', { success: false, message: 'Kullanıcı adı ve şifre boş olamaz!' });
            }
            const existing = await User.findOne({ username: data.username });
            if (existing) {
                return socket.emit('authResult', { success: false, message: 'Bu gladyatör adı zaten alınmış!' });
            }
            const newUser = new User({
                username: data.username,
                password: data.password
            });
            await newUser.save();
            socket.emit('authResult', { success: true, message: 'Kayıt başarılı! Şimdi giriş yapabilirsiniz.' });
        } catch (err) {
            socket.emit('authResult', { success: false, message: 'Kayıt sırasında bir hata oluştu.' });
        }
    });

    // Giriş Yapma
    socket.on('userLogin', async (data) => {
        try {
            const user = await User.findOne({ username: data.username, password: data.password });
            if (!user) {
                return socket.emit('authResult', { success: false, message: 'Hatalı kullanıcı adı veya şifre!' });
            }
            loggedInUser = user;
            socket.emit('authResult', { success: true, message: 'Giriş başarılı!' });
            socket.emit('userData', user);
        } catch (err) {
            socket.emit('authResult', { success: false, message: 'Giriş yapılırken bir hata oluştu.' });
        }
    });

    // Stat Dağıtma
    socket.on('distributeStat', async (statType) => {
        if (!loggedInUser) return;
        let user = await User.findById(loggedInUser._id);
        if (user.statPoints > 0) {
            user.statPoints -= 1;
            if (statType === 'str') user.str += 1;
            if (statType === 'vit') {
                user.vit += 1;
                user.hp = user.vit * 20;
            }
            await user.save();
            loggedInUser = user;
            socket.emit('userData', user);
        }
    });

    // Sefer / Görev Yapma
    socket.on('doQuest', async (data) => {
        if (!loggedInUser) return;
        let user = await User.findById(loggedInUser._id);
        
        const quests = {
            1: { gold: 45, exp: 20, damage: 15, name: "Karanlık Orman" },
            2: { gold: 120, exp: 55, damage: 35, name: "Unutulmuş Tapınak" },
            3: { gold: 300, exp: 140, damage: 70, name: "Ejderha Mağarası" }
        };

        const quest = quests[data.questId];
        if (!quest) return;

        const maxHp = user.vit * 20;
        if (user.hp < quest.damage) {
            return socket.emit('questResult', { success: false, message: 'Canınız bu sefer için çok az! Dinlenmelisiniz.' });
        }

        user.hp -= quest.damage;
        user.balance += quest.gold;
        user.exp += quest.exp;

        // Seviye Atlama Kontrolü
        const maxExp = user.level * 100;
        if (user.exp >= maxExp) {
            user.exp -= maxExp;
            user.level += 1;
            user.statPoints += 3;
            user.hp = maxHp; // Seviye atlayınca canı fulle
        }

        await user.save();
        loggedInUser = user;
        socket.emit('questResult', { success: true, message: `${quest.name} seferi tamamlandı! +${quest.gold} Altın, +${quest.exp} Tecrübe kazandınız.`, userData: user });
    });

    // Eşya Kuşanma (Equip)
    socket.on('equipItem', async (itemIndex) => {
        if (!loggedInUser) return;
        let user = await User.findById(loggedInUser._id);

        if (itemIndex < 0 || itemIndex >= user.inventory.length) return;

        const item = user.inventory[itemIndex];
        const slotType = item.type; // örn: 'weapon', 'armor'

        if (!user.equipped) {
            user.equipped = { helmet: null, necklace: null, armor: null, weapon: null, shield: null, ring: null, gloves: null, boots: null };
        }

        // Eğer o slotta halihazırda eşya varsa envantere geri koy
        const currentlyEquipped = user.equipped[slotType];
        
        // Envanterden eşyayı çıkar
        user.inventory.splice(itemIndex, 1);

        if (currentlyEquipped) {
            user.inventory.push(currentlyEquipped);
        }

        // Yeni eşyayı kuşan
        user.equipped[slotType] = item;

        await user.save();
        loggedInUser = user;
        socket.emit('userData', user);
    });

    // Sohbet Mesajı
    socket.on('sendChatMessage', (data) => {
        if (!loggedInUser) return;
        if (!data.message || data.message.trim() === "") return;
        io.emit('receiveChatMessage', { username: loggedInUser.username, message: data.message.trim() });
    });

    // Çıkış Yapma
    socket.on('logout', () => {
        loggedInUser = null;
        socket.emit('logoutSuccess');
    });

    socket.on('disconnect', () => {
        console.log('Bir gezgin ayrıldı.');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor...`);
});
