const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Public klasöründen statik sunum
app.use(express.static(path.join(__dirname, 'public')));

// Anlık Oyuncu Veritabanı
const players = {};

// Görevler (Hasar oranları eklendi)
const QUESTS = {
  1: { name: 'Karanlık Orman Bandidoları', gold: 45, exp: 20, damage: 15 },
  2: { name: 'Unutulmuş Tapınak Harabeleri', gold: 120, exp: 55, damage: 30 },
  3: { name: 'Ejderha Dağı Etekleri', gold: 300, exp: 140, damage: 50 }
};

// Pazar / Mülk Verileri
const ESTATES = {
  1: { name: 'Küçük Buğday Çiftliği', cost: 500, incomePerMin: 10 },
  2: { name: 'Üzüm Bağı ve Şaraphane', cost: 2000, incomePerMin: 45 },
  3: { name: 'Sınır Kalesi ve Ticaret Noktası', cost: 7500, incomePerMin: 180 }
};

// Dakikalık Pasif Mülk Gelir Döngüsü
setInterval(() => {
  Object.keys(players).forEach(socketId => {
    const player = players[socketId];
    if (player && player.estates) {
      let passiveIncome = 0;
      Object.keys(player.estates).forEach(estateId => {
        const count = player.estates[estateId];
        if (count > 0 && ESTATES[estateId]) {
          passiveIncome += ESTATES[estateId].incomePerMin * count;
        }
      });

      if (passiveIncome > 0) {
        player.balance += passiveIncome;
        io.to(socketId).emit('marketResult', {
          userData: player,
          message: `Tımarlarınızdan ${passiveIncome} Altın pasif gelir toplandı!`
        });
      }
    }
  });
}, 60000);

io.on('connection', (socket) => {
  console.log(`Yeni oyuncu bağlandı: ${socket.id}`);

  // 1. KULLANICI GİRİŞİ (userLogin)
  socket.on('userLogin', (data) => {
    const username = data.username ? data.username.trim() : 'Bilinmeyen Savaşçı';
    const baseVit = 5;

    players[socket.id] = {
      id: socket.id,
      username: username,
      level: 1,
      balance: 250,
      rubies: 10,
      exp: 0,
      statPoints: 5,
      str: 5,
      int: 5,
      dex: 5,
      vit: baseVit,
      hp: baseVit * 20, // Max HP = VIT * 20 (100 HP)
      upgrades: { weapon: 0, armor: 0, helmet: 0 },
      estates: { 1: 0, 2: 0, 3: 0 }
    };

    socket.emit('userData', players[socket.id]);
    
    io.emit('receiveChatMessage', {
      username: 'Sistem',
      message: `${username} meydanlara adım attı!`
    });
  });

  // 2. NİTELİK DAĞITIMI (distributeStat)
  socket.on('distributeStat', (statName) => {
    const player = players[socket.id];
    if (!player) return;

    if (player.statPoints > 0 && ['str', 'int', 'dex', 'vit'].includes(statName)) {
      player.statPoints -= 1;
      player[statName] += 1;

      // VIT artarsa Maksimum ve mevcut HP +20 yükselir
      if (statName === 'vit') {
        player.hp += 20;
      }

      socket.emit('statUpdated', player);
    }
  });

  // 3. SEFER DÜZENLEME & HASAR ALMA (doQuest)
  socket.on('doQuest', (data) => {
    const player = players[socket.id];
    if (!player) return;

    const quest = QUESTS[data.questId];
    if (!quest) return;

    // Can kontrolü
    if (player.hp <= 10) {
      return socket.emit('questResult', {
        userData: player,
        message: "⚠️ Canınız çok düşük (10 HP altı)! Sefere çıkmak için önce iksir içmelisiniz.",
        goldEarned: 0,
        expEarned: 0
      });
    }

    // Hasar ve ödül hesabı
    const damageTaken = quest.damage;
    player.hp = Math.max(0, player.hp - damageTaken);

    player.balance += quest.gold;
    player.exp += quest.exp;

    // Seviye Atlama (Gerekli EXP: Level * 100)
    let maxExp = player.level * 100;
    let leveledUp = false;

    if (player.exp >= maxExp) {
      player.level += 1;
      player.exp -= maxExp;
      player.statPoints += 3;
      player.hp = player.vit * 20; // Seviye atlayınca can fuller
      leveledUp = true;
    }

    let msg = `${quest.name} seferinde ${damageTaken} HP kaybettiniz.`;
    if (leveledUp) {
      msg += ` 🎉 SEVİYE ATLADINIZ (${player.level}. Seviye)! Canınız tazelendi, +3 Stat puanı kazandınız.`;
    }

    socket.emit('questResult', {
      userData: player,
      message: msg,
      goldEarned: quest.gold,
      expEarned: quest.exp
    });
  });

  // 4. İKSİR KULLANMA (usePotion)
  socket.on('usePotion', () => {
    const player = players[socket.id];
    if (!player) return;

    const maxHp = player.vit * 20;
    const potionCost = 50;

    if (player.hp >= maxHp) {
      return socket.emit('questResult', {
        userData: player,
        message: "Canınız zaten tamamen dolu!",
        goldEarned: 0,
        expEarned: 0
      });
    }

    if (player.balance >= potionCost) {
      player.balance -= potionCost;
      player.hp = Math.min(maxHp, player.hp + 50);
      socket.emit('questResult', {
        userData: player,
        message: "🧪 İksir içildi! +50 HP kazanıldı.",
        goldEarned: 0,
        expEarned: 0
      });
    } else {
      socket.emit('questResult', {
        userData: player,
        message: "Yetersiz Altın! İksir bedeli: 50 Altın.",
        goldEarned: 0,
        expEarned: 0
      });
    }
  });

  // 5. MÜLK SATIN ALMA (buyEstate)
  socket.on('buyEstate', (data) => {
    const player = players[socket.id];
    if (!player) return;

    const estate = ESTATES[data.estateId];
    if (!estate) return;

    if (player.balance >= estate.cost) {
      player.balance -= estate.cost;
      player.estates[data.estateId] = (player.estates[data.estateId] || 0) + 1;

      socket.emit('marketResult', {
        userData: player,
        message: `${estate.name} satın alındı! Pasif gelirinize eklendi.`
      });
    } else {
      socket.emit('marketResult', {
        userData: player,
        message: `Yetersiz Altın! ${estate.name} için ${estate.cost} Altın gerekiyor.`
      });
    }
  });

  // 6. DEMİRHANE / + BASMA (upgradeItem)
  socket.on('upgradeItem', (data) => {
    const player = players[socket.id];
    if (!player) return;

    const itemType = data.itemType;
    if (player.upgrades[itemType] === undefined) return;

    const currentLevel = player.upgrades[itemType];
    const cost = (currentLevel + 1) * 100;

    if (player.balance >= cost) {
      player.balance -= cost;
      player.upgrades[itemType] += 1;

      // Nitelik bonusları
      if (itemType === 'weapon') player.str += 1;
      if (itemType === 'armor') {
        player.vit += 1;
        player.hp += 20;
      }
      if (itemType === 'helmet') player.int += 1;

      socket.emit('forgeResult', {
        userData: player,
        itemType: itemType,
        newLevel: player.upgrades[itemType],
        message: `Teçhizatınız +${player.upgrades[itemType]} seviyesine yükseltildi!`
      });
    } else {
      socket.emit('forgeResult', {
        userData: player,
        itemType: itemType,
        newLevel: currentLevel,
        message: `Yetersiz Altın! Yükseltme bedeli: ${cost} Altın.`
      });
    }
  });

  // 7. SOHBET (sendChatMessage)
  socket.on('sendChatMessage', (data) => {
    const player = players[socket.id];
    if (!player || !data.message) return;

    const cleanMsg = data.message.trim();
    if (cleanMsg.length === 0) return;

    io.emit('receiveChatMessage', {
      username: player.username,
      message: cleanMsg
    });
  });

  // Bağlantı Kopması
  socket.on('disconnect', () => {
    delete players[socket.id];
    console.log(`Oyuncu ayrıldı: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Diyar Online sunucusu ${PORT} portunda aktif! http://localhost:${PORT}`);
});
