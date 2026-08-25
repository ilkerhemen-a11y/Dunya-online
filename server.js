const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(__dirname + '/public'));

// Sabitler ve Yardımcı Fonksiyonlar
const MAX_SEFER_LIMITI = 20;
const REFILL_INTERVAL = 30 * 60 * 1000; // 30 Dakika (milisaniye)

function checkSeferRefill(user) {
    const now = Date.now();
    if (user.seferLimiti <= 0 && user.seferNextRefill && now >= user.seferNextRefill) {
        user.seferLimiti = MAX_SEFER_LIMITI;
        user.seferNextRefill = null;
        return true;
    }
    return false;
}

// 1. MongoDB Bağlantısı
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/throne_war';
mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB bağlantısı başarılı!'))
    .catch(err => console.error('MongoDB bağlantı hatası:', err));

// 2. Kullanıcı Veritabanı Şeması
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
    seferNextRefill: { type: Number, default: null },
    estates: { type: [Number], default: [] },
    upgrades: { weapon: { type: Number, default: 0 }, armor: { type: Number, default: 0 }, helmet: { type: Number, default: 0 } },
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
    inventory: { type: Array, default: [] }
});

const User = mongoose.model('User', userSchema);
const users = {}; 

const getDefaultInventory = () => [
    { id: 'item_1', name: 'Tahta Kılıç', icon: '🗡️', type: 'weapon', strBonus: 3, vitBonus: 0, level: 0 },
    { id: 'item_2', name: 'Deri Zırh', icon: 'https://i.hizliresim.com/hnneaa5l.jpg', type: 'armor', strBonus: 0, vitBonus: 5, level: 0 },
    { id: 'item_3', name: 'Bakır Kolye', icon: '📿', type: 'necklace', strBonus: 1, vitBonus: 2, level: 0 }
];

io.on('connection', (socket) => {
    console.log('Yeni bir gladyatör bağlandı:', socket.id);

    // Kayıt Olma İşlemi
    socket.on('userRegister', async (data) => {
        const { username, password } = data;
        if (!username || !password || username.trim() === '' || password.trim() === '') {
            return socket.emit('authResult', { success: false, message: "Kullanıcı adı ve şifre boş olamaz!" });
        }

        try {
            const existingUser = await User.findOne({ username });
            if (existingUser) {
                return socket.emit('authResult', { success: false, message: "Bu isimde bir gladyatör zaten var!" });
            }

            const hashedPassword = await bcrypt.hash(password, 10);
            const newUser = new User({ 
                username: username, 
                password: hashedPassword,
                inventory: getDefaultInventory() 
            });
            await newUser.save();
            
            socket.emit('authResult', { success: true, message: "Kayıt başarılı! Şimdi giriş yapabilirsiniz." });
        } catch (err) { 
            console.error("Kayıt hatası:", err); 
            socket.emit('authResult', { success: false, message: "Sunucu hatası oluştu." });
        }
    });

    // Giriş Yapma İşlemi
    socket.on('userLogin', async (data) => {
        const { username, password } = data;
        try {
            const dbUser = await User.findOne({ username });
            if (!dbUser) {
                return socket.emit('authResult', { success: false, message: "Böyle bir kullanıcı bulunamadı." });
            }

            const isPasswordValid = await bcrypt.compare(password, dbUser.password);
            if (!isPasswordValid) {
                return socket.emit('authResult', { success: false, message: "Hatalı şifre!" });
            }

            if (checkSeferRefill(dbUser)) {
                await dbUser.save();
            }

            users[socket.id] = dbUser;
            socket.emit('userData', dbUser);
        } catch (err) { 
            console.error("Giriş hatası:", err); 
            socket.emit('authResult', { success: false, message: "Giriş yapılırken bir hata oluştu." });
        }
    });

    // Çıkış Yapma
    socket.on('logout', () => {
        if (users[socket.id]) {
            console.log('Gladyatör çıkış yaptı:', users[socket.id].username);
            delete users[socket.id];
            socket.emit('logoutSuccess');
            socket.disconnect();
        }
    });

    // Stat Puanı Dağıtımı
    socket.on('distributeStat', async (statName) => {
        const user = users[socket.id];
        if (user && user.statPoints > 0) {
            if (statName === 'str') user.str += 1;
            if (statName === 'vit') { user.vit += 1; user.hp += 20; }
            user.statPoints -= 1;
            await user.save();
            socket.emit('statUpdated', user);
        }
    });

    // Görev (Sefer) Sistemi
    socket.on('doQuest', async (data) => {
        const user = users[socket.id];
        if (!user) return;

        checkSeferRefill(user);

        if (user.hp <= 0) {
            return socket.emit('questResult', { success: false, message: "Canınız yetersiz!" });
        }

        if (user.seferLimiti <= 0) {
            const kalanDakika = Math.ceil((user.seferNextRefill - Date.now()) / (1000 * 60));
            return socket.emit('questResult', { 
                success: false, 
                message: `Sefer hakkınız bitti! Yenilenmeye kalan süre: ${kalanDakika} dakika.` 
            });
        }

        user.seferLimiti -= 1;

        if (user.seferLimiti === 0) {
            user.seferNextRefill = Date.now() + REFILL_INTERVAL;
        }

        const questId = data.questId || 1;
        let goldGain = 0, expGain = 0, hpLoss = 0, questName = "";

        if (questId === 1) { goldGain = 45; expGain = 20; hpLoss = 15; questName = "Karanlık Orman"; }
        else if (questId === 2) { goldGain = 120; expGain = 55; hpLoss = 35; questName = "Unutulmuş Tapınak"; }
        else if (questId === 3) { goldGain = 300; expGain = 140; hpLoss = 70; questName = "Ejderha Dağı"; }

        user.hp = Math.max(0, user.hp - hpLoss);
        user.balance += goldGain;
        user.exp += expGain;

        let maxExp = user.level * 100;
        let levelUpMsg = "";
        if (user.exp >= maxExp) {
            user.level += 1;
            user.exp -= maxExp;
            user.statPoints += 3;
            user.hp = user.vit * 20;
            levelUpMsg = " SEVİYE ATLADIN!";
        }

        await user.save();
        socket.emit('questResult', { 
            success: true, 
            userData: user, 
            message: `${questName} seferi başarılı!${levelUpMsg}`, 
            goldEarned: goldGain, 
            expEarned: expGain, 
            hpLost: hpLoss 
        });
    });

    // Tımar Satın Alma
    socket.on('buyEstate', async (data) => {
        const user = users[socket.id];
        if (!user) return;
        
        let cost = 0;
        if (data.estateId === 1) cost = 500;
        if (data.estateId === 2) cost = 2000;
        if (data.estateId === 3) cost = 7500;

        if (user.estates.includes(data.estateId)) return socket.emit('marketResult', { userData: user, message: "Bu mülke zaten sahipsiniz!" });
        if (user.balance < cost) return socket.emit('marketResult', { userData: user, message: "Yeterli altınınız yok!" });

        user.balance -= cost;
        user.estates.push(data.estateId);
        await user.save();
        socket.emit('marketResult', { userData: user, message: "Mülk başarıyla satın alındı! Artık pasif gelir getirecek." });
    });

    // ==========================================
    // DEMİRCİ (+ BASMA) - ENVANTERDEKİ EŞYAYI GELİŞTİRME
    // ==========================================
    socket.on('upgradeItem', async (data) => {
        try {
            const activeUser = users[socket.id];
            if (!activeUser) {
                return socket.emit('forgeResult', { 
                    success: false, 
                    message: "Lütfen önce giriş yapın." 
                });
            }

            const user = await User.findById(activeUser._id);
            if (!user) return;

            const { itemIndex } = data;

            // Envanter ve eşya geçerlilik kontrolü
            if (!user.inventory || !user.inventory[itemIndex]) {
                return socket.emit('forgeResult', { 
                    success: false, 
                    message: "Geliştirilecek eşya envanterde bulunamadı!" 
                });
            }

            const item = user.inventory[itemIndex];
            const currentLevel = item.level || 0;
            const nextLevel = currentLevel + 1;
            const cost = nextLevel * 150; // Seviye arttıkça + basma maliyeti artar

            // Altın kontrolü
            if ((user.balance || 0) < cost) {
                return socket.emit('forgeResult', { 
                    success: false, 
                    message: `Yetersiz altın! +${nextLevel} basmak için ${cost} Altın gerekiyor.` 
                });
            }

            // Altını düş
            user.balance -= cost;

            // Eşya ismindeki eski + seviyesini temizle ve yenisini ekle
            let baseName = item.name.replace(/\s\+\d+$/, '');
            item.name = `${baseName} +${nextLevel}`;
            item.level = nextLevel;

            // Stat bonuslarını artır (+1 basıldığında mevcut bonusa ekleme yapılır)
            item.strBonus = (item.strBonus || 0) + 2;
            item.vitBonus = (item.vitBonus || 0) + 2;

            // Envanter dizisini güncellendi olarak işaretle
            user.markModified('inventory');
            await user.save();

            // Oturum bilgilerini güncelle
            users[socket.id] = user;

            socket.emit('forgeResult', {
                success: true,
                message: `🔥 Başarılı! Eşyanız ${item.name} seviyesine yükseltildi!`,
                userData: user
            });
            socket.emit('statUpdated', user);

        } catch (err) {
            console.error("Demirhane hatası:", err);
            socket.emit('forgeResult', { 
                success: false, 
                message: "Geliştirme sırasında bir sunucu hatası oluştu." 
            });
        }
    });

    // Can İksiri
    socket.on('usePotion', async () => {
        const user = users[socket.id];
        if (user && user.balance >= 50) {
            user.balance -= 50; 
            user.hp = user.vit * 20;
            await user.save();
            socket.emit('statUpdated', user);
            socket.emit('marketResult', { userData: user, message: "Canınız yenilendi!" });
        }
    });

    // Sefer Limiti Yenileme İksiri (50 Altın)
    socket.on('refillSefer', async () => {
        const user = users[socket.id];
        if (!user) return;

        if (user.seferLimiti >= MAX_SEFER_LIMITI) {
            return socket.emit('marketResult', { userData: user, message: "Sefer hakkınız zaten maksimum seviyede!" });
        }

        if (user.balance < 50) {
            return socket.emit('marketResult', { userData: user, message: "Yeterli altınınız yok!" });
        }

        user.balance -= 50;
        user.seferLimiti = MAX_SEFER_LIMITI;
        user.seferNextRefill = null;
        await user.save();

        socket.emit('statUpdated', user);
        socket.emit('marketResult', { userData: user, message: "Sefer limitiniz 20/20 olarak yenilendi!" });
    });

    // Ekipman Kuşanma/Çıkarma
    socket.on('equipItem', async (data) => {
        const user = users[socket.id];
        if (!user || data.itemIndex < 0 || data.itemIndex >= user.inventory.length) return;
        
        const item = user.inventory[data.itemIndex];
        const old = user.equipped[item.type];
        user.inventory.splice(data.itemIndex, 1);
        if (old) user.inventory.push(old);
        user.equipped[item.type] = item;
        user.markModified('equipped'); 
        user.markModified('inventory');
        await user.save();
        socket.emit('statUpdated', user);
    });

        // Eşya Silme İşlemi
    socket.on('deleteItem', async (data) => {
        const user = users[socket.id];
        if (!user || data.itemIndex === undefined || data.itemIndex < 0 || data.itemIndex >= user.inventory.length) return;

        // Eşyayı envanter dizisinden kaldır
        user.inventory.splice(data.itemIndex, 1);
        
        user.markModified('inventory');
        await user.save();

        // Güncel veriyi istemciye gönder
        socket.emit('statUpdated', user);
    });

    socket.on('unequipItem', async (data) => {
        const user = users[socket.id];
        if (!user || !user.equipped[data.slot]) return;
        user.inventory.push(user.equipped[data.slot]);
        user.equipped[data.slot] = null;
        user.markModified('equipped'); 
        user.markModified('inventory');
        await user.save();
        socket.emit('statUpdated', user);
    });

    // Sohbet
    socket.on('sendChatMessage', (data) => {
        io.emit('receiveChatMessage', { username: users[socket.id]?.username, message: data.message });
    });

    socket.on('disconnect', () => delete users[socket.id]);
});




    // ==========================================
    // ŞİFRESİZ OTOMATİK GİRİŞ / KAYIT SİSTEMİ
    // ==========================================
    socket.on('autoLoginUser', async (data) => {
        try {
            const username = data.username || "KaranNova";
            
            // Kullanıcı veritabanında var mı diye bak
            let dbUser = await User.findOne({ username });

            // Eğer kullanıcı daha önce oluşturulmamışsa otomatik olarak oluştur
            if (!dbUser) {
                dbUser = new User({ 
                    username: username, 
                    password: "autogenerated_secure_pass", // Şifresiz giriş için geçersiz bir şifre
                    inventory: getDefaultInventory() 
                });
                await dbUser.save();
            }

            // Sefer haklarını kontrol et ve oturuma ata
            if (checkSeferRefill(dbUser)) {
                await dbUser.save();
            }

            users[socket.id] = dbUser;
            socket.emit('userData', dbUser);

        } catch (err) {
            console.error("Otomatik giriş hatası:", err);
        }
    });




// PASİF GELİR VE OTOMATİK CAN YENİLEME DÖNGÜSÜ (60 Saniyede Bir)
setInterval(async () => {
    for (const socketId in users) {
        const user = users[socketId];
        let isUpdated = false;

        // 1. Pasif Gelir Hesabı
        let income = 0;
        if (user.estates.includes(1)) income += 10;
        if (user.estates.includes(2)) income += 45;
        if (user.estates.includes(3)) income += 180;

        if (income > 0) {
            user.balance += income;
            isUpdated = true;
        }

        // 2. Otomatik Can Yenileme (Maksimum Can: Dayanıklılık * 20)
        const maxHp = user.vit * 20;
        if (user.hp < maxHp) {
            user.hp = Math.min(maxHp, user.hp + 10);
            isUpdated = true;
        }

        // Herhangi bir değişiklik gerçekleştiyse kaydet ve istemciyi güncelle
        if (isUpdated) {
            await user.save();
            io.to(socketId).emit('statUpdated', user);
        }
    }
}, 60000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Sunucu http://localhost:${PORT} aktif.`));
