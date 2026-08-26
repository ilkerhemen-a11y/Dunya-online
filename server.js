const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Statik dosyalar için (Eğer HTML aynı dizindeyse veya public klasöründeyse)
app.use(express.static('public'));

// MongoDB Bağlantısı (Kendi bağlantı adresini buraya yazabilirsin)
mongoose.connect('mongodb://127.0.0.1:27017/taht_savasi', {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log('MongoDB bağlantısı başarılı!')).catch(err => console.log('DB Bağlantı Hatası:', err));

// Kullanıcı Şeması
const userSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    level: { type: Number, default: 1 },
    exp: { type: Number, default: 0 },
    balance: { type: Number, default: 1000 },
    rubies: { type: Number, default: 10 },
    hp: { type: Number, default: 100 },
    str: { type: Number, default: 5 },
    vit: { type: Number, default: 5 },
    statPoints: { type: Number, default: 0 },
    seferLimiti: { type: Number, default: 20 },
    inventory: { type: Array, default: [] },
    equipped: {
        type: Object,
        default: { helmet: null, necklace: null, armor: null, weapon: null, shield: null, ring: null, gloves: null, boots: null }
    },
    estates: { type: Array, default: [] }
});

const User = mongoose.model('User', userSchema);

// BOSS'tan Düşebilecek Eşya Havuzu
const bossItemPool = [
    { name: "Ejderha Miğferi", icon: "🪖", strBonus: 6, vitBonus: 4, level: 0 },
    { name: "Alev Kılıcı", icon: "🗡️", strBonus: 12, vitBonus: 3, level: 0 },
    { name: "Kraliyet Zırhı", icon: "🛡️", strBonus: 5, vitBonus: 15, level: 0 },
    { name: "Kadim Kolye", icon: "📿", strBonus: 7, vitBonus: 7, level: 0 },
    { name: "Ejderha Çizmesi", icon: "👢", strBonus: 4, vitBonus: 6, level: 0 },
    { name: "Titan Eldiveni", icon: "🧤", strBonus: 8, vitBonus: 5, level: 0 }
];

io.on('connection', (socket) => {
    console.log('Bir gezgin bağlandı:', socket.id);

    // Kayıt Ol
    socket.on('userRegister', async (data) => {
        try {
            const existing = await User.findOne({ username: data.username });
            if (existing) {
                return socket.emit('authResult', { success: false, message: 'Bu gladyatör adı zaten alınmış!' });
            }
            const newUser = new User({
                username: data.username,
                password: data.password,
                hp: 100
            });
            await newUser.save();
            socket.emit('authResult', { success: true, message: 'Kayıt başarılı! Şimdi giriş yapabilirsin.' });
        } catch (err) {
            socket.emit('authResult', { success: false, message: 'Kayıt sırasında bir hata oluştu.' });
        }
    });

    // Giriş Yap
    socket.on('userLogin', async (data) => {
        try {
            const user = await User.findOne({ username: data.username, password: data.password });
            if (!user) {
                return socket.emit('authResult', { success: false, message: 'Hatalı kullanıcı adı veya şifre!' });
            }
            socket.userId = user._id;
            socket.emit('userData', user);
        } catch (err) {
            socket.emit('authResult', { success: false, message: 'Giriş yapılırken hata oluştu.' });
        }
    });

    // Çıkış Yap
    socket.on('logout', () => {
        socket.userId = null;
        socket.emit('logoutSuccess');
    });

    // Stat Dağıtımı
    socket.on('distributeStat', async (statType) => {
        if (!socket.userId) return;
        const user = await User.findById(socket.userId);
        if (!user || user.statPoints <= 0) return;

        user.statPoints -= 1;
        if (statType === 'str') user.str += 1;
        if (statType === 'vit') {
            user.vit += 1;
            user.hp = user.vit * 20; // Canı tazele
        }
        await user.save();
        socket.emit('statUpdated', user);
    });

    // Zindan & Boss Savaşları
    socket.on('doDungeon', async (data) => {
        if (!socket.userId) return;
        const user = await User.findById(socket.userId);
        if (!user) return;

        const { floor } = data;
        let goldReward = 0;
        let expReward = 0;
        let hpCost = 0;
        let isBoss = (floor === 4);

        if (floor === 1) { goldReward = 100; expReward = 40; hpCost = 20; }
        else if (floor === 2) { goldReward = 250; expReward = 90; hpCost = 45; }
        else if (floor === 3) { goldReward = 600; expReward = 200; hpCost = 90; }
        else if (floor === 4) { goldReward = 1500; expReward = 500; hpCost = 120; }

        const maxHp = (user.vit || 5) * 20;
        if (user.hp === undefined) user.hp = maxHp;

        if (user.hp < hpCost) {
            return socket.emit('dungeonResult', { success: false, message: 'Canınız bu zindan katı için yetersiz! İksir ile iyileşin.', userData: user });
        }

        user.hp -= hpCost;
        user.balance += goldReward;
        user.exp += expReward;

        let dropMessage = "";
        if (isBoss) {
            // Havuzdan rastgele 1 eşya seç ve envantere ekle
            const randomIndex = Math.floor(Math.random() * bossItemPool.length);
            const droppedItem = { ...bossItemPool[randomIndex] };
            
            if (!user.inventory) user.inventory = [];
            user.inventory.push(droppedItem);
            dropMessage = ` | Ganimet: ${droppedItem.icon} ${droppedItem.name} envanterine düştü!`;
        }

        // Seviye Atlama Kontrolü
        const maxExp = (user.level || 1) * 100;
        if (user.exp >= maxExp) {
            user.exp -= maxExp;
            user.level += 1;
            user.statPoints += 3;
            user.hp = user.vit * 20;
        }

        await user.save();
        socket.emit('dungeonResult', {
            success: true,
            message: `Zafer! Kat ${floor} temizlendi! Kazanım: +${goldReward} Altın, +${expReward} Tecrübe${dropMessage}`,
            userData: user
        });
    });

    // Eşya Kuşanma
    socket.on('equipItem', async (data) => {
        if (!socket.userId) return;
        const user = await User.findById(socket.userId);
        if (!user || !user.inventory[data.itemIndex]) return;

        const item = user.inventory[data.itemIndex];
        // Basit slot eşleştirme mantığı
        let slot = 'weapon';
        if (item.icon === '🪖') slot = 'helmet';
        else if (item.icon === '📿') slot = 'necklace';
        else if (item.icon === '🛡️') slot = 'armor';
        else if (item.icon === '🛡') slot = 'shield';
        else if (item.icon === '💍') slot = 'ring';
        else if (item.icon === '🧤') slot = 'gloves';
        else if (item.icon === '👢') slot = 'boots';

        // Eskisini çantaya geri koy, yenisini tak
        if (user.equipped[slot]) {
            user.inventory.push(user.equipped[slot]);
        }
        user.equipped[slot] = item;
        user.inventory.splice(data.itemIndex, 1);

        await user.save();
        socket.emit('statUpdated', user);
    });

    // Eşya Çıkartma
    socket.on('unequipItem', async (data) => {
        if (!socket.userId) return;
        const user = await User.findById(socket.userId);
        if (!user || !user.equipped[data.slot]) return;

        user.inventory.push(user.equipped[data.slot]);
        user.equipped[data.slot] = null;

        await user.save();
        socket.emit('statUpdated', user);
    });

    // Eşya Silme
    socket.on('deleteItem', async (data) => {
        if (!socket.userId) return;
        const user = await User.findById(socket.userId);
        if (!user || !user.inventory[data.itemIndex]) return;

        user.inventory.splice(data.itemIndex, 1);
        await user.save();
        socket.emit('statUpdated', user);
    });

    // Can İksiri Kullanma
    socket.on('usePotion', async () => {
        if (!socket.userId) return;
        const user = await User.findById(socket.userId);
        if (!user || user.balance < 50) {
            return socket.emit('marketResult', { success: false, message: 'Yeterli altınınız yok! (Maliyet: 50 Altın)' });
        }

        user.balance -= 50;
        user.hp = user.vit * 20;
        await user.save();
        socket.emit('marketResult', { success: true, message: 'Can iksiri içildi, sağlığınız tamamen doldu!', userData: user });
    });

    // Sohbet Mesajı
    socket.on('sendChatMessage', (data) => {
        io.emit('receiveChatMessage', { username: 'Gezgin', message: data.message });
    });

    socket.on('disconnect', () => {
        console.log('Bir gezgin ayrıldı.');
    });
});

server.listen(3000, () => {
    console.log('Sunucu 3000 portunda çalışıyor...');
});
