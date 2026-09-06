const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const GAME_BUILD_ID = '2026-09-06-clan-war-daily-19-v2';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(__dirname + '/public'));

const MAX_SEFER_LIMITI = 20;
const REFILL_INTERVAL = 3 * 60 * 1000;
const MAX_LEVEL = 99;

// --- ONUR ÖDÜL SİSTEMİ ---
const HONOR_RUBY_STEP = 100;
const HONOR_RUBY_REWARD = 10;

const BANK_MAX_DEPOSIT = 100000;
const BANK_INTEREST_RATE = 0.50;
const BANK_TERM_MS = 24 * 60 * 60 * 1000;

const TIMAR_MAX_LEVEL = 5;
const TIMAR_BUILDING_MAX_LEVEL = 3;
const TIMAR_THRONE_BONUS = 0.10;

const TIMAR_DEFINITIONS = {
    1: {
        id: 1,
        name: 'Küçük Çiftlik',
        icon: '🌾',
        purchaseCost: 500,
        baseIncome: 10,
        baseTreasuryCap: 25000,
        description: 'İmparatorluğun temel tarım bölgesi.'
    },
    2: {
        id: 2,
        name: 'Kervansaray',
        icon: '🏘️',
        purchaseCost: 2000,
        baseIncome: 15,
        baseTreasuryCap: 40000,
        description: 'Ticaret yollarını besleyen zengin geçiş noktası.'
    },
    3: {
        id: 3,
        name: 'Altın Madeni',
        icon: '⛏️',
        purchaseCost: 7500,
        baseIncome: 20,
        baseTreasuryCap: 60000,
        description: 'Yüksek gelirli fakat korunması gereken maden bölgesi.'
    }
};

const TIMAR_LEVEL_MULTIPLIERS = {
    1: 1.00,
    2: 1.20,
    3: 1.50,
    4: 1.80,
    5: 2.20
};

const TIMAR_TAX_POLICIES = {
    low: {
        key: 'low',
        name: 'Düşük Vergi',
        incomeMultiplier: 0.80,
        loyaltyPerHour: 3
    },
    normal: {
        key: 'normal',
        name: 'Normal Vergi',
        incomeMultiplier: 1.00,
        loyaltyPerHour: 0.5
    },
    heavy: {
        key: 'heavy',
        name: 'Ağır Vergi',
        incomeMultiplier: 1.25,
        loyaltyPerHour: -4
    }
};

const TIMAR_BUILDINGS = {
    farm: {
        key: 'farm',
        name: 'Çiftlik',
        icon: '🌾',
        costMultiplier: 2,
        description: 'Her seviye Tımar gelirini %5 artırır.'
    },
    market: {
        key: 'market',
        name: 'Pazar',
        icon: '🏪',
        costMultiplier: 3,
        description: 'Her seviye geliri %3, hazine kapasitesini %15 artırır.'
    },
    guard: {
        key: 'guard',
        name: 'Karakol',
        icon: '🛡️',
        costMultiplier: 4,
        description: 'Eşkıya/İsyan ihtimalini ve olay gelir kaybını azaltır.'
    },
    stable: {
        key: 'stable',
        name: 'Ahır',
        icon: '🐎',
        costMultiplier: 5,
        description: 'En yüksek Ahır seviyesi Süvari maliyetini seviye başına %3 azaltır.'
    }
};

const BLACKSMITH_MAX_LEVEL = 20;
const BLACKSMITH_BASE_XP = 100;

const TITLE_TIERS = [
    { level: 99, title: 'Tahtın Efendisi' },
    { level: 90, title: 'Efsane' },
    { level: 80, title: 'İmparator' },
    { level: 70, title: 'Fatih' },
    { level: 60, title: 'Büyük Kumandan' },
    { level: 50, title: 'Savaş Lordu' },
    { level: 40, title: 'Komutan' },
    { level: 30, title: 'Şampiyon' },
    { level: 20, title: 'Muhafız' },
    { level: 10, title: 'Savaşçı' },
    { level: 1, title: 'Çaylak' }
];

function getTitleByLevel(level) {
    const safeLevel = Math.max(1, Math.min(MAX_LEVEL, Number(level) || 1));
    return TITLE_TIERS.find(tier => safeLevel >= tier.level)?.title || 'Çaylak';
}

function calculateMaxHpForProgression(user) {
    return Math.max(20, getTotalVit(user) * 20);
}

function normalizePlayerLevel(user) {
    let changed = false;
    let level = Number.parseInt(user.level, 10);

    if (!Number.isInteger(level) || level < 1) level = 1;
    if (level > MAX_LEVEL) level = MAX_LEVEL;

    if (user.level !== level) {
        user.level = level;
        changed = true;
    }

    if (user.level >= MAX_LEVEL && (Number(user.exp) || 0) !== 0) {
        user.exp = 0;
        changed = true;
    }

    return changed;
}

function processLevelUps(user) {
    normalizePlayerLevel(user);

    const startLevel = user.level;
    const oldTitle = getTitleByLevel(startLevel);
    let levelUps = 0;

    while (user.level < MAX_LEVEL && user.exp >= user.level * 100) {
        user.exp -= user.level * 100;
        user.level += 1;
        user.statPoints += 3;
        levelUps += 1;
    }

    if (user.level >= MAX_LEVEL) {
        user.level = MAX_LEVEL;
        user.exp = 0;
    }

    if (levelUps > 0) {
        user.hp = calculateMaxHpForProgression(user);
    }

    const newTitle = getTitleByLevel(user.level);

    return {
        levelUps,
        level: user.level,
        oldTitle,
        newTitle,
        titleChanged: oldTitle !== newTitle,
        reachedMax: user.level >= MAX_LEVEL
    };
}


function applyHonorChange(user, amount) {
    const requestedChange = Number.parseInt(amount, 10) || 0;
    const beforeHonor = Math.max(0, Number(user?.honor) || 0);

    // Eski oyuncuların geçmiş 100'lük eşikleri yeniden ödül üretmesin.
    // İlk kez yeni sisteme dokunulduğunda mevcut Onur seviyesi başlangıç kabul edilir.
    if (!user.honorRewardInitialized) {
        user.honorRubyMilestone = Math.floor(beforeHonor / HONOR_RUBY_STEP);
        user.honorRewardInitialized = true;
    }

    const previousMilestone = Math.max(
        0,
        Number.parseInt(user.honorRubyMilestone, 10) || 0
    );

    user.honor = Math.max(0, beforeHonor + requestedChange);

    let rubyReward = 0;
    let milestonesGained = 0;

    if (requestedChange > 0) {
        const reachedMilestone = Math.floor(user.honor / HONOR_RUBY_STEP);

        if (reachedMilestone > previousMilestone) {
            milestonesGained = reachedMilestone - previousMilestone;
            rubyReward = milestonesGained * HONOR_RUBY_REWARD;
            user.rubies = Math.max(0, Number(user.rubies) || 0) + rubyReward;
            user.honorRubyMilestone = reachedMilestone;
        }
    }

    return {
        honorChange: user.honor - beforeHonor,
        newHonor: user.honor,
        rubyReward,
        milestonesGained,
        nextHonorTarget: (Math.max(
            previousMilestone,
            Number.parseInt(user.honorRubyMilestone, 10) || 0
        ) + 1) * HONOR_RUBY_STEP
    };
}


const METIN_STONES = {
    // Tüm Metin taşlarında yeniden doğma süresi en az 4 saattir.
    // hpCostPercent: Her vuruşta oyuncunun maksimum HP'sinden düşecek yüzde.
    1: { name: 'Savaş Metini', icon: '🪨', requiredLevel: 1,  maxHp: 500,   respawnMs: 4 * 60 * 60 * 1000,  papers: 1, hpCostPercent: 4 },
    2: { name: 'Gölge Metini', icon: '🌑', requiredLevel: 20, maxHp: 2000,  respawnMs: 6 * 60 * 60 * 1000,  papers: 1, hpCostPercent: 5 },
    3: { name: 'Ruh Metini', icon: '💠', requiredLevel: 40, maxHp: 6000,  respawnMs: 8 * 60 * 60 * 1000,  papers: 1, hpCostPercent: 6 },
    4: { name: 'Kıyamet Metini', icon: '🔥', requiredLevel: 60, maxHp: 15000, respawnMs: 12 * 60 * 60 * 1000, papers: 1, hpCostPercent: 7 },
    5: { name: 'Taht Metini', icon: '👑', requiredLevel: 80, maxHp: 35000, respawnMs: 24 * 60 * 60 * 1000, papers: 2, hpCostPercent: 8 }
};

const EQUIP_SLOTS = ['helmet', 'necklace', 'armor', 'weapon', 'shield', 'ring', 'gloves', 'boots'];

const HUKUMDAR_SET_ID = 'hukumdar_set';

const HUKUMDAR_SET_ITEMS = {
    helmet: { name: 'Tuğra Tacı', icon: '👑', type: 'helmet', strBonus: 14, vitBonus: 18 },
    necklace: { name: 'Saray Kolyesi', icon: '📿', type: 'necklace', strBonus: 20, vitBonus: 12 },
    armor: { name: 'Hümayun Zırhı', icon: '🛡️', type: 'armor', strBonus: 12, vitBonus: 32 },
    weapon: { name: 'Hakan Kılıcı', icon: '⚔️', type: 'weapon', strBonus: 35, vitBonus: 8 },
    shield: { name: 'Cihan Kalkanı', icon: '🛡', type: 'shield', strBonus: 10, vitBonus: 28 },
    ring: { name: 'Fetih Yüzüğü', icon: '💍', type: 'ring', strBonus: 18, vitBonus: 14 },
    gloves: { name: 'Serdar Eldiveni', icon: '🧤', type: 'gloves', strBonus: 22, vitBonus: 10 },
    boots: { name: 'Akıncı Çizmesi', icon: '👢', type: 'boots', strBonus: 16, vitBonus: 16 }
};

const HUKUMDAR_SET_BONUSES = {
    twoPieceStrPercent: 3,
    fourPieceVitPercent: 5,
    sixPieceCastleAttackPercent: 3,
    eightPieceCombatPowerPercent: 5
};

const TROOP_TYPES = {
    archer:   { name: 'Okçu',     icon: '🏹', cost: 250,  power: 10 },
    warrior:  { name: 'Savaşçı',  icon: '⚔️', cost: 500,  power: 20 },
    cavalry:  { name: 'Süvari',   icon: '🐎', cost: 1000, power: 35 },
    catapult: { name: 'Mancınık', icon: '🪵', cost: 3000, power: 100 }
};

const CASTLE_WALL_POWER = 500;
const CASTLE_DEFENSE_BONUS = 1.15;

const NPC_CASTLE_ARMY = {
    archer: 50,
    warrior: 30,
    cavalry: 20,
    catapult: 0
};

function normalizeArmy(user) {
    if (!user.army) {
        user.army = { archer: 0, warrior: 0, cavalry: 0, catapult: 0 };
        user.markModified('army');
        return true;
    }

    let changed = false;

    for (const type of Object.keys(TROOP_TYPES)) {
        let amount = Number.parseInt(user.army[type], 10);

        if (!Number.isInteger(amount) || amount < 0) {
            amount = 0;
        }

        if (user.army[type] !== amount) {
            user.army[type] = amount;
            changed = true;
        }
    }

    if (changed) user.markModified('army');
    return changed;
}

function getArmyPower(army) {
    if (!army) return 0;

    return Object.entries(TROOP_TYPES).reduce((total, [type, troop]) => {
        const amount = Math.max(0, Number.parseInt(army[type], 10) || 0);
        return total + (amount * troop.power);
    }, 0);
}

function cloneArmy(army) {
    return {
        archer: Math.max(0, Number.parseInt(army?.archer, 10) || 0),
        warrior: Math.max(0, Number.parseInt(army?.warrior, 10) || 0),
        cavalry: Math.max(0, Number.parseInt(army?.cavalry, 10) || 0),
        catapult: Math.max(0, Number.parseInt(army?.catapult, 10) || 0)
    };
}

function applyArmyLosses(army, lossRate) {
    const before = cloneArmy(army);
    const after = {};
    const lost = {};

    for (const type of Object.keys(TROOP_TYPES)) {
        const amount = before[type];
        const loss = Math.min(amount, Math.max(0, Math.round(amount * lossRate)));

        lost[type] = loss;
        after[type] = Math.max(0, amount - loss);
    }

    return { before, after, lost };
}

function getArmyCount(army) {
    const safe = cloneArmy(army);
    return Object.values(safe).reduce((total, amount) => total + (Number(amount) || 0), 0);
}

function normalizeSiegeMarketState(user) {
    let changed = false;

    if (!user.siegePreparations) {
        user.siegePreparations = {
            armyRations: false,
            warDrum: false,
            commanderEdict: false
        };
        changed = true;
    }

    for (const key of ['armyRations', 'warDrum', 'commanderEdict']) {
        const value = Boolean(user.siegePreparations[key]);

        if (user.siegePreparations[key] !== value) {
            user.siegePreparations[key] = value;
            changed = true;
        }
    }

    if (!user.lastCastleLosses) {
        user.lastCastleLosses = {
            archer: 0,
            warrior: 0,
            cavalry: 0,
            catapult: 0,
            available: false
        };
        changed = true;
    }

    for (const type of ['archer', 'warrior', 'cavalry', 'catapult']) {
        const amount = Math.max(
            0,
            Number.parseInt(user.lastCastleLosses[type], 10) || 0
        );

        if (user.lastCastleLosses[type] !== amount) {
            user.lastCastleLosses[type] = amount;
            changed = true;
        }
    }

    user.lastCastleLosses.available =
        Boolean(user.lastCastleLosses.available);

    if (changed) {
        user.markModified('siegePreparations');
        user.markModified('lastCastleLosses');
    }

    return changed;
}

function formatArmyLosses(lost) {
    return `🏹 ${lost.archer || 0} Okçu | ⚔️ ${lost.warrior || 0} Savaşçı | 🐎 ${lost.cavalry || 0} Süvari | 🏗️ ${lost.catapult || 0} Mancınık`;
}

function normalizeBankState(user) {
    let changed = false;

    if (!user.bankDeposit) {
        user.bankDeposit = {
            principal: 0,
            startedAt: 0,
            maturesAt: 0
        };
        user.markModified('bankDeposit');
        return true;
    }

    let principal = Number.parseInt(user.bankDeposit.principal, 10);
    let startedAt = Number(user.bankDeposit.startedAt) || 0;
    let maturesAt = Number(user.bankDeposit.maturesAt) || 0;

    if (!Number.isInteger(principal) || principal < 0) {
        principal = 0;
        changed = true;
    }

    principal = Math.min(BANK_MAX_DEPOSIT, principal);

    if (principal <= 0) {
        principal = 0;

        if (startedAt !== 0 || maturesAt !== 0) {
            startedAt = 0;
            maturesAt = 0;
            changed = true;
        }
    } else {
        if (!startedAt) {
            startedAt = Date.now();
            changed = true;
        }

        if (!maturesAt || maturesAt <= startedAt) {
            maturesAt = startedAt + BANK_TERM_MS;
            changed = true;
        }
    }

    if (user.bankDeposit.principal !== principal) changed = true;
    if (user.bankDeposit.startedAt !== startedAt) changed = true;
    if (user.bankDeposit.maturesAt !== maturesAt) changed = true;

    user.bankDeposit.principal = principal;
    user.bankDeposit.startedAt = startedAt;
    user.bankDeposit.maturesAt = maturesAt;

    if (changed) {
        user.markModified('bankDeposit');
    }

    return changed;
}


function getEquipmentStatTotals(user) {
    let str = 0;
    let vit = 0;

    if (user?.equipped) {
        Object.values(user.equipped).forEach(item => {
            if (!item) return;
            str += Number(item.strBonus) || 0;
            vit += Number(item.vitBonus) || 0;
        });
    }

    return { str: Math.max(0, str), vit: Math.max(0, vit) };
}

function getHukumdarSetEquippedCount(user) {
    if (!user?.equipped) return 0;
    return Object.values(user.equipped).filter(item =>
        item && item.setId === HUKUMDAR_SET_ID
    ).length;
}

function getOwnedHukumdarSetSlots(user) {
    const owned = new Set();

    if (user?.equipped) {
        for (const [slot, item] of Object.entries(user.equipped)) {
            if (item && item.setId === HUKUMDAR_SET_ID) owned.add(slot);
        }
    }

    if (Array.isArray(user?.inventory)) {
        user.inventory.forEach(item => {
            if (item && item.setId === HUKUMDAR_SET_ID && EQUIP_SLOTS.includes(item.type)) {
                owned.add(item.type);
            }
        });
    }

    return Array.from(owned);
}

function getHukumdarSetBonusState(user) {
    const pieceCount = getHukumdarSetEquippedCount(user);
    return {
        pieceCount,
        strPercent: pieceCount >= 2 ? HUKUMDAR_SET_BONUSES.twoPieceStrPercent : 0,
        vitPercent: pieceCount >= 4 ? HUKUMDAR_SET_BONUSES.fourPieceVitPercent : 0,
        castleAttackPercent: pieceCount >= 6 ? HUKUMDAR_SET_BONUSES.sixPieceCastleAttackPercent : 0,
        combatPowerPercent: pieceCount >= 8 ? HUKUMDAR_SET_BONUSES.eightPieceCombatPowerPercent : 0
    };
}

function getTotalStr(user) {
    const equipment = getEquipmentStatTotals(user);
    const setBonus = getHukumdarSetBonusState(user);
    const raw = (Number(user?.str) || 5) + equipment.str;
    const total = setBonus.strPercent > 0
        ? Math.floor(raw * (1 + (setBonus.strPercent / 100)))
        : raw;
    return Math.max(1, total);
}

function getTotalVit(user) {
    const equipment = getEquipmentStatTotals(user);
    const setBonus = getHukumdarSetBonusState(user);
    const raw = (Number(user?.vit) || 5) + equipment.vit;
    const total = setBonus.vitPercent > 0
        ? Math.floor(raw * (1 + (setBonus.vitPercent / 100)))
        : raw;
    return Math.max(1, total);
}

function getCharacterCombatPower(user) {
    const totalStr = getTotalStr(user);
    const totalVit = getTotalVit(user);
    const setBonus = getHukumdarSetBonusState(user);
    let power = (totalStr * 2) + totalVit;

    if (setBonus.combatPowerPercent > 0) {
        power = Math.floor(power * (1 + (setBonus.combatPowerPercent / 100)));
    }

    const adventureBonusPercent =
        typeof getAdventureCombatBonusPercent === 'function'
            ? getAdventureCombatBonusPercent(user)
            : 0;

    if (adventureBonusPercent > 0) {
        power = Math.floor(
            power *
            (1 + (adventureBonusPercent / 100))
        );
    }

    return Math.max(1, power);
}

function createHukumdarSetItem(slot, source = 'Bilinmeyen Kaynak') {
    const base = HUKUMDAR_SET_ITEMS[slot];
    if (!base) return null;

    return {
        id: `hukumdar_${slot}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
        setId: HUKUMDAR_SET_ID,
        setName: 'Hükümdar Seti',
        source,
        name: base.name,
        icon: base.icon,
        type: base.type,
        level: 0,
        rarity: 'Efsanevi',
        strBonus: base.strBonus,
        vitBonus: base.vitBonus,
        description: 'Taht Savaşları’nın en nadir Hükümdar Seti parçalarından biri.'
    };
}

function tryGrantHukumdarSetPiece(user, chance, source) {
    if (!user || Math.random() >= chance) return null;

    const slots = Object.keys(HUKUMDAR_SET_ITEMS);
    const slot = slots[Math.floor(Math.random() * slots.length)];
    const item = createHukumdarSetItem(slot, source);
    if (!item) return null;

    user.inventory.push(item);
    user.markModified('inventory');
    return item;
}

function normalizeMetinState(user) {
    const count = Object.keys(METIN_STONES).length;
    const hp = Array.isArray(user.metinStoneHp) ? Array.from(user.metinStoneHp) : [];
    const respawns = Array.isArray(user.metinStoneRespawnAt) ? Array.from(user.metinStoneRespawnAt) : [];
    const now = Date.now();

    let changed = false;

    while (hp.length < count) {
        hp.push(METIN_STONES[hp.length + 1].maxHp);
        changed = true;
    }

    while (respawns.length < count) {
        respawns.push(0);
        changed = true;
    }

    if (hp.length > count) {
        hp.length = count;
        changed = true;
    }

    if (respawns.length > count) {
        respawns.length = count;
        changed = true;
    }

    for (let i = 0; i < count; i++) {
        const stone = METIN_STONES[i + 1];

        let currentHp = Number(hp[i]);
        if (!Number.isFinite(currentHp)) {
            currentHp = stone.maxHp;
            changed = true;
        }

        currentHp = Math.max(0, Math.min(stone.maxHp, Math.floor(currentHp)));

        let respawnAt = Number(respawns[i]) || 0;

        if (currentHp <= 0 && respawnAt > 0 && now >= respawnAt) {
            currentHp = stone.maxHp;
            respawnAt = 0;
            changed = true;
        }

        // Eski veya bozuk kayıtlarda taş kaybolmasın.
        if (currentHp <= 0 && respawnAt <= 0) {
            currentHp = stone.maxHp;
            changed = true;
        }

        if (hp[i] !== currentHp) {
            hp[i] = currentHp;
            changed = true;
        }

        if (respawns[i] !== respawnAt) {
            respawns[i] = respawnAt;
            changed = true;
        }
    }

    user.metinStoneHp = hp;
    user.metinStoneRespawnAt = respawns;

    if (changed) {
        user.markModified('metinStoneHp');
        user.markModified('metinStoneRespawnAt');
    }

    return changed;
}

function createBlessingPaper() {
    return {
        id: `blessing_scroll_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
        baseId: 'blessing_scroll',
        name: 'Kutsama Kağıdı',
        icon: '📜',
        type: 'material',
        rarity: 'Nadir',
        level: 0,
        strBonus: 0,
        vitBonus: 0,
        description: 'Özel geliştirme malzemesi. Demirhane sistemi için saklanabilir.'
    };
}

function checkSeferRefill(user) {
    const now = Date.now();

    let current = Number.parseInt(user.seferLimiti, 10);
    if (!Number.isInteger(current)) current = MAX_SEFER_LIMITI;

    current = Math.max(0, Math.min(MAX_SEFER_LIMITI, current));

    let changed = user.seferLimiti !== current;
    user.seferLimiti = current;

    // Sefer zaten tam doluysa sayaç tutulmaz.
    if (user.seferLimiti >= MAX_SEFER_LIMITI) {
        if (user.seferNextRefill) {
            user.seferNextRefill = null;
            changed = true;
        }
        return changed;
    }

    let nextRefill = Number(user.seferNextRefill) || 0;

    // Eski 30 dakikalık sistemden kalan çok uzak tarihleri
    // yeni sisteme geçir: en geç 3 dakika sonra ilk hak gelsin.
    if (nextRefill > now + REFILL_INTERVAL) {
        nextRefill = now + REFILL_INTERVAL;
        user.seferNextRefill = nextRefill;
        changed = true;
    }

    // Eksik Sefer Hakkı var ama sayaç yoksa yeni 3 dk sayaç başlat.
    if (!nextRefill) {
        user.seferNextRefill = now + REFILL_INTERVAL;
        return true;
    }

    if (now < nextRefill) {
        return changed;
    }

    // Geçen süre kadar hakkı birer birer geri yükle.
    // Örn. oyuncu 9 dk çevrimdışı kaldıysa 3 hak geri gelir.
    const elapsedIntervals =
        Math.floor((now - nextRefill) / REFILL_INTERVAL) + 1;

    const missing = MAX_SEFER_LIMITI - user.seferLimiti;
    const restored = Math.min(missing, elapsedIntervals);

    if (restored > 0) {
        user.seferLimiti += restored;
        changed = true;
    }

    if (user.seferLimiti >= MAX_SEFER_LIMITI) {
        user.seferLimiti = MAX_SEFER_LIMITI;
        user.seferNextRefill = null;
    } else {
        user.seferNextRefill =
            nextRefill + (restored * REFILL_INTERVAL);
    }

    return changed;
}

function checkArenaReset(user) {
    const today = new Date().toDateString();
    if (user.arenaResetDate !== today) {
        user.arenaLimit = 5;
        user.arenaResetDate = today;
        return true;
    }
    return false;
}


const DUNGEON_DAILY_LIMIT = 5;

function getTurkeyDayKey() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Istanbul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());
}

function checkDungeonDailyReset(user) {
    const today = getTurkeyDayKey();
    const current = Array.isArray(user.dungeonDailyAttempts)
        ? Array.from(user.dungeonDailyAttempts)
        : [];

    while (current.length < 10) current.push(0);
    if (current.length > 10) current.length = 10;

    let changed = false;

    if (user.dungeonResetDate !== today) {
        for (let i = 0; i < 10; i++) current[i] = 0;
        user.dungeonResetDate = today;
        changed = true;
    }

    for (let i = 0; i < 10; i++) {
        const safeValue = Number.isFinite(Number(current[i]))
            ? Math.max(0, Math.min(DUNGEON_DAILY_LIMIT, Math.floor(Number(current[i]))))
            : 0;
        if (current[i] !== safeValue) {
            current[i] = safeValue;
            changed = true;
        }
    }

    user.dungeonDailyAttempts = current;
    if (changed) user.markModified('dungeonDailyAttempts');
    return changed;
}

function getBlacksmithXpNeeded(level) {
    const safeLevel = Math.max(1, Math.min(BLACKSMITH_MAX_LEVEL, Number(level) || 1));
    return BLACKSMITH_BASE_XP + ((safeLevel - 1) * 25);
}

function getBlacksmithDiscount(level) {
    const safeLevel = Math.max(1, Math.min(BLACKSMITH_MAX_LEVEL, Number(level) || 1));
    return Math.min(0.10, (safeLevel - 1) * 0.005);
}

function normalizeBlacksmithState(user) {
    let changed = false;

    if (!user.blacksmithMastery) {
        user.blacksmithMastery = { level: 1, exp: 0, ironOre: 0 };
        user.markModified('blacksmithMastery');
        return true;
    }

    let level = Number.parseInt(user.blacksmithMastery.level, 10);
    let exp = Number.parseInt(user.blacksmithMastery.exp, 10);
    let ironOre = Number.parseInt(user.blacksmithMastery.ironOre, 10);

    if (!Number.isInteger(level) || level < 1) level = 1;
    if (level > BLACKSMITH_MAX_LEVEL) level = BLACKSMITH_MAX_LEVEL;
    if (!Number.isInteger(exp) || exp < 0) exp = 0;
    if (!Number.isInteger(ironOre) || ironOre < 0) ironOre = 0;

    if (level >= BLACKSMITH_MAX_LEVEL) exp = 0;

    if (user.blacksmithMastery.level !== level) changed = true;
    if (user.blacksmithMastery.exp !== exp) changed = true;
    if (user.blacksmithMastery.ironOre !== ironOre) changed = true;

    user.blacksmithMastery.level = level;
    user.blacksmithMastery.exp = exp;
    user.blacksmithMastery.ironOre = ironOre;

    if (changed) user.markModified('blacksmithMastery');
    return changed;
}

function grantBlacksmithMasteryXp(user, amount) {
    normalizeBlacksmithState(user);

    const result = {
        gained: Math.max(0, Number.parseInt(amount, 10) || 0),
        levelsGained: 0,
        level: user.blacksmithMastery.level
    };

    if (result.gained <= 0 || user.blacksmithMastery.level >= BLACKSMITH_MAX_LEVEL) {
        return result;
    }

    user.blacksmithMastery.exp += result.gained;

    while (user.blacksmithMastery.level < BLACKSMITH_MAX_LEVEL) {
        const needed = getBlacksmithXpNeeded(user.blacksmithMastery.level);
        if (user.blacksmithMastery.exp < needed) break;

        user.blacksmithMastery.exp -= needed;
        user.blacksmithMastery.level += 1;
        result.levelsGained += 1;
    }

    if (user.blacksmithMastery.level >= BLACKSMITH_MAX_LEVEL) {
        user.blacksmithMastery.level = BLACKSMITH_MAX_LEVEL;
        user.blacksmithMastery.exp = 0;
    }

    result.level = user.blacksmithMastery.level;
    user.markModified('blacksmithMastery');
    return result;
}

function getSmeltOreYield(item) {
    const level = Math.max(0, Number.parseInt(item?.level, 10) || 0);
    const rarity = item?.rarity || 'Sıradan';

    if (rarity === 'Efsanevi') return 18 + Math.floor(level / 2);
    if (rarity === 'Epik') return 10 + Math.floor(level / 3);
    if (rarity === 'Nadir') return 5 + Math.floor(level / 4);
    return 2 + Math.floor(level / 5);
}

function createDefaultTimarState(estateId, user, now = Date.now()) {
    const fallbackTime =
        Number(user?.lastCollected) > 0
            ? Number(user.lastCollected)
            : now;

    return {
        estateId: Number(estateId),
        level: 1,
        loyalty: 75,
        taxPolicy: 'normal',
        treasury: 0,
        lastAccruedAt: fallbackTime,
        buildings: {
            farm: 0,
            market: 0,
            guard: 0,
            stable: 0
        },
        event: {
            active: false,
            type: '',
            name: '',
            penaltyPercent: 0,
            createdAt: 0
        }
    };
}

function normalizeTimarState(user) {
    if (!user) return false;

    let changed = false;

    if (!Array.isArray(user.estates)) {
        user.estates = [];
        changed = true;
    }

    if (!Array.isArray(user.timarStates)) {
        user.timarStates = [];
        changed = true;
    }

    const ownedIds = user.estates
        .map(id => Number(id))
        .filter(id => !!TIMAR_DEFINITIONS[id]);

    for (const estateId of ownedIds) {
        let state = user.timarStates.find(
            item => Number(item?.estateId) === estateId
        );

        if (!state) {
            user.timarStates.push(
                createDefaultTimarState(estateId, user)
            );
            changed = true;
            continue;
        }

        const safeLevel = Math.max(
            1,
            Math.min(
                TIMAR_MAX_LEVEL,
                Number.parseInt(state.level, 10) || 1
            )
        );

        const safeLoyalty = Math.max(
            0,
            Math.min(100, Number(state.loyalty) || 0)
        );

        const safeTaxPolicy =
            TIMAR_TAX_POLICIES[state.taxPolicy]
                ? state.taxPolicy
                : 'normal';

        const safeTreasury = Math.max(
            0,
            Number(state.treasury) || 0
        );

        const safeLastAccruedAt =
            Number(state.lastAccruedAt) > 0
                ? Number(state.lastAccruedAt)
                : Date.now();

        if (state.level !== safeLevel) {
            state.level = safeLevel;
            changed = true;
        }
        if (Number(state.loyalty) !== safeLoyalty) {
            state.loyalty = safeLoyalty;
            changed = true;
        }
        if (state.taxPolicy !== safeTaxPolicy) {
            state.taxPolicy = safeTaxPolicy;
            changed = true;
        }
        if (Number(state.treasury) !== safeTreasury) {
            state.treasury = safeTreasury;
            changed = true;
        }
        if (Number(state.lastAccruedAt) !== safeLastAccruedAt) {
            state.lastAccruedAt = safeLastAccruedAt;
            changed = true;
        }

        if (!state.buildings) {
            state.buildings = { farm: 0, market: 0, guard: 0, stable: 0 };
            changed = true;
        }

        for (const buildingType of Object.keys(TIMAR_BUILDINGS)) {
            const safeBuildingLevel = Math.max(
                0,
                Math.min(
                    TIMAR_BUILDING_MAX_LEVEL,
                    Number.parseInt(state.buildings?.[buildingType], 10) || 0
                )
            );

            if (Number(state.buildings?.[buildingType]) !== safeBuildingLevel) {
                state.buildings[buildingType] = safeBuildingLevel;
                changed = true;
            }
        }

        if (!state.event) {
            state.event = {
                active: false,
                type: '',
                name: '',
                penaltyPercent: 0,
                createdAt: 0
            };
            changed = true;
        }

        state.event.active = Boolean(state.event.active);
        state.event.penaltyPercent = Math.max(
            0,
            Math.min(50, Number(state.event.penaltyPercent) || 0)
        );
    }

    if (changed) {
        user.markModified('estates');
        user.markModified('timarStates');
    }

    return changed;
}

function getTimarState(user, estateId) {
    normalizeTimarState(user);
    return user.timarStates.find(
        state => Number(state?.estateId) === Number(estateId)
    ) || null;
}

function getTimarLoyaltyMultiplier(loyalty) {
    const safe = Math.max(0, Math.min(100, Number(loyalty) || 0));
    if (safe >= 80) return 1.10;
    if (safe >= 60) return 1.05;
    if (safe >= 40) return 1.00;
    if (safe >= 20) return 0.85;
    return 0.65;
}

function getTimarTreasuryCap(state) {
    const definition = TIMAR_DEFINITIONS[Number(state?.estateId)];
    if (!definition) return 0;

    const level = Math.max(1, Math.min(TIMAR_MAX_LEVEL, Number(state?.level) || 1));
    const marketLevel = Math.max(
        0,
        Math.min(TIMAR_BUILDING_MAX_LEVEL, Number(state?.buildings?.market) || 0)
    );

    const levelCapacityMultiplier = 1 + ((level - 1) * 0.25);
    const marketCapacityMultiplier = 1 + (marketLevel * 0.15);

    return Math.floor(
        definition.baseTreasuryCap *
        levelCapacityMultiplier *
        marketCapacityMultiplier
    );
}

function getTimarIncomePerMinute(state, isThroneOwner = false) {
    const definition = TIMAR_DEFINITIONS[Number(state?.estateId)];
    if (!definition) return 0;

    const level = Math.max(1, Math.min(TIMAR_MAX_LEVEL, Number(state?.level) || 1));
    const tax = TIMAR_TAX_POLICIES[state?.taxPolicy] || TIMAR_TAX_POLICIES.normal;
    const farmLevel = Math.max(0, Math.min(TIMAR_BUILDING_MAX_LEVEL, Number(state?.buildings?.farm) || 0));
    const marketLevel = Math.max(0, Math.min(TIMAR_BUILDING_MAX_LEVEL, Number(state?.buildings?.market) || 0));
    const levelMultiplier = TIMAR_LEVEL_MULTIPLIERS[level] || 1;
    const farmMultiplier = 1 + (farmLevel * 0.05);
    const marketMultiplier = 1 + (marketLevel * 0.03);
    const loyaltyMultiplier = getTimarLoyaltyMultiplier(state?.loyalty);
    const throneMultiplier = isThroneOwner ? (1 + TIMAR_THRONE_BONUS) : 1;
    const eventPenalty = state?.event?.active
        ? Math.max(0, Math.min(0.50, (Number(state.event.penaltyPercent) || 0) / 100))
        : 0;

    const income =
        definition.baseIncome *
        levelMultiplier *
        tax.incomeMultiplier *
        farmMultiplier *
        marketMultiplier *
        loyaltyMultiplier *
        throneMultiplier *
        (1 - eventPenalty);

    return Math.max(1, Math.round(income));
}

function getTimarLevelUpgradeCost(state) {
    const definition = TIMAR_DEFINITIONS[Number(state?.estateId)];
    if (!definition) return 0;
    const currentLevel = Math.max(1, Number(state?.level) || 1);
    if (currentLevel >= TIMAR_MAX_LEVEL) return 0;
    return Math.floor(definition.purchaseCost * currentLevel * 2);
}

function getTimarBuildingUpgradeCost(state, buildingType) {
    const definition = TIMAR_DEFINITIONS[Number(state?.estateId)];
    const building = TIMAR_BUILDINGS[buildingType];
    if (!definition || !building) return 0;

    const currentLevel = Math.max(0, Number(state?.buildings?.[buildingType]) || 0);
    if (currentLevel >= TIMAR_BUILDING_MAX_LEVEL) return 0;

    return Math.floor(
        definition.purchaseCost *
        building.costMultiplier *
        (currentLevel + 1)
    );
}

function maybeTriggerTimarEvent(state, elapsedMinutes) {
    if (!state || state?.event?.active || elapsedMinutes <= 0) return false;

    const guardLevel = Math.max(
        0,
        Math.min(TIMAR_BUILDING_MAX_LEVEL, Number(state?.buildings?.guard) || 0)
    );

    const elapsedHours = elapsedMinutes / 60;
    const protectionMultiplier = Math.max(0.35, 1 - (guardLevel * 0.20));
    const chance = Math.min(0.35, elapsedHours * 0.025 * protectionMultiplier);

    if (Math.random() >= chance) return false;

    const events = [
        { type: 'bandits', name: 'Eşkıya Baskını' },
        { type: 'rebellion', name: 'Vergi İsyanı' },
        { type: 'caravan', name: 'Kervan Yağması' }
    ];
    const chosen = events[Math.floor(Math.random() * events.length)];
    const penaltyPercent = Math.max(8, 20 - (guardLevel * 4));

    state.event.active = true;
    state.event.type = chosen.type;
    state.event.name = chosen.name;
    state.event.penaltyPercent = penaltyPercent;
    state.event.createdAt = Date.now();
    return true;
}

function accrueTimarIncome(user, now = Date.now(), isThroneOwner = false) {
    normalizeTimarState(user);

    let totalAdded = 0;
    let changed = false;
    let eventTriggered = false;

    for (const estateId of user.estates) {
        const state = getTimarState(user, estateId);
        if (!state) continue;

        const lastAccruedAt = Number(state.lastAccruedAt) || now;
        const elapsedMinutes = Math.floor((now - lastAccruedAt) / 60000);
        if (elapsedMinutes <= 0) continue;

        const incomePerMinute = getTimarIncomePerMinute(state, isThroneOwner);
        const earned = Math.max(0, Math.floor(elapsedMinutes * incomePerMinute));
        const capacity = getTimarTreasuryCap(state);
        const currentTreasury = Math.max(0, Number(state.treasury) || 0);
        const freeSpace = Math.max(0, capacity - currentTreasury);
        const added = Math.min(freeSpace, earned);

        if (added > 0) {
            state.treasury = currentTreasury + added;
            totalAdded += added;
            changed = true;
        }

        const tax = TIMAR_TAX_POLICIES[state.taxPolicy] || TIMAR_TAX_POLICIES.normal;
        const loyaltyDelta = (elapsedMinutes / 60) * tax.loyaltyPerHour;
        const nextLoyalty = Math.max(
            0,
            Math.min(100, (Number(state.loyalty) || 0) + loyaltyDelta)
        );

        if (Math.abs(nextLoyalty - (Number(state.loyalty) || 0)) > 0.001) {
            state.loyalty = Math.round(nextLoyalty * 10) / 10;
            changed = true;
        }

        state.lastAccruedAt = lastAccruedAt + (elapsedMinutes * 60000);
        changed = true;

        if (maybeTriggerTimarEvent(state, elapsedMinutes)) {
            eventTriggered = true;
            changed = true;
        }
    }

    user.lastCollected = now;
    if (changed) user.markModified('timarStates');

    return { totalAdded, changed, eventTriggered };
}

function getTimarCavalryDiscount(user) {
    normalizeTimarState(user);
    let highestStableLevel = 0;

    for (const estateId of user.estates) {
        const state = getTimarState(user, estateId);
        highestStableLevel = Math.max(
            highestStableLevel,
            Number(state?.buildings?.stable) || 0
        );
    }

    return Math.min(0.09, highestStableLevel * 0.03);
}

function buildTimarStatusPayload(user, isThroneOwner = false) {
    normalizeTimarState(user);

    const timars = [];
    let totalTreasury = 0;
    let totalIncomePerMin = 0;

    for (const estateId of user.estates) {
        const state = getTimarState(user, estateId);
        const definition = TIMAR_DEFINITIONS[Number(estateId)];
        if (!state || !definition) continue;

        const incomePerMinute = getTimarIncomePerMinute(state, isThroneOwner);
        const treasuryCap = getTimarTreasuryCap(state);
        totalTreasury += Number(state.treasury) || 0;
        totalIncomePerMin += incomePerMinute;

        const buildingCosts = {};
        for (const buildingType of Object.keys(TIMAR_BUILDINGS)) {
            buildingCosts[buildingType] = getTimarBuildingUpgradeCost(state, buildingType);
        }

        timars.push({
            estateId: Number(estateId),
            definition,
            level: Number(state.level) || 1,
            loyalty: Math.round((Number(state.loyalty) || 0) * 10) / 10,
            taxPolicy: state.taxPolicy || 'normal',
            treasury: Math.floor(Number(state.treasury) || 0),
            treasuryCap,
            incomePerMinute,
            buildings: {
                farm: Number(state.buildings?.farm) || 0,
                market: Number(state.buildings?.market) || 0,
                guard: Number(state.buildings?.guard) || 0,
                stable: Number(state.buildings?.stable) || 0
            },
            buildingCosts,
            nextLevelCost: getTimarLevelUpgradeCost(state),
            event: {
                active: Boolean(state.event?.active),
                type: state.event?.type || '',
                name: state.event?.name || '',
                penaltyPercent: Number(state.event?.penaltyPercent) || 0,
                createdAt: Number(state.event?.createdAt) || 0
            }
        });
    }

    return {
        userData: user,
        definitions: Object.values(TIMAR_DEFINITIONS),
        taxPolicies: TIMAR_TAX_POLICIES,
        buildingDefinitions: TIMAR_BUILDINGS,
        timars,
        totalTreasury: Math.floor(totalTreasury),
        totalIncomePerMin,
        throneBonusPercent: isThroneOwner ? Math.round(TIMAR_THRONE_BONUS * 100) : 0,
        cavalryDiscountPercent: Math.round(getTimarCavalryDiscount(user) * 100)
    };
}

async function getTimarStatusForUser(user, shouldAccrue = true) {
    const castle = await getOrCreateCastle();
    const isThroneOwner = Boolean(
        castle?.ownerId && String(castle.ownerId) === String(user?._id)
    );

    if (shouldAccrue) {
        accrueTimarIncome(user, Date.now(), isThroneOwner);
    }

    return buildTimarStatusPayload(user, isThroneOwner);
}

async function calculateOfflineGold(user) {
    normalizeTimarState(user);
    const before = (user.timarStates || []).reduce(
        (sum, state) => sum + (Number(state?.treasury) || 0),
        0
    );

    const status = await getTimarStatusForUser(user, true);
    const after = status.totalTreasury || 0;
    return Math.max(0, Math.floor(after - before));
}

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/throne_war';
mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB bağlantısı başarılı!'))
    .catch(err => console.error('MongoDB bağlantı hatası:', err));

const userSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    token: { type: String, default: null },
    lastCollected: { type: Number, default: Date.now },
    level: { type: Number, default: 1 },
    exp: { type: Number, default: 0 },
    balance: { type: Number, default: 100 },
    rubies: { type: Number, default: 15 },
    goldKeys: { type: Number, default: 0 },
    dungeonFloor: { type: Number, default: 1 },
    dungeonDailyAttempts: { type: [Number], default: () => Array(10).fill(0) },
    dungeonResetDate: { type: String, default: "" },

    // --- KLAN SİSTEMİ ---
    clanId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clan', default: null },
    clanRole: { type: String, default: null }, // leader | officer | member
    clanContribution: { type: Number, default: 0 },

    metinStoneHp: { type: [Number], default: () => Object.values(METIN_STONES).map(stone => stone.maxHp) },
    metinStoneRespawnAt: { type: [Number], default: () => Object.values(METIN_STONES).map(() => 0) },
    str: { type: Number, default: 5 },
    vit: { type: Number, default: 5 },
    statPoints: { type: Number, default: 0 },
    hp: { type: Number, default: 100 },
    honor: { type: Number, default: 0 },
    honorRubyMilestone: { type: Number, default: 0 },
    honorRewardInitialized: { type: Boolean, default: false },
    arenaWins: { type: Number, default: 0 },
    dungeonBossWins: { type: Number, default: 0 },
    metinKills: { type: Number, default: 0 },
    arenaLimit: { type: Number, default: 5 },
    arenaResetDate: { type: String, default: "" },
    seferLimiti: { type: Number, default: 20 },
    seferNextRefill: { type: Number, default: null },
    estates: { type: [Number], default: [] },

    timarStates: {
        type: [{
            estateId: { type: Number, required: true },
            level: { type: Number, default: 1 },
            loyalty: { type: Number, default: 75 },
            taxPolicy: { type: String, default: 'normal' },
            treasury: { type: Number, default: 0 },
            lastAccruedAt: { type: Number, default: Date.now },
            buildings: {
                farm: { type: Number, default: 0 },
                market: { type: Number, default: 0 },
                guard: { type: Number, default: 0 },
                stable: { type: Number, default: 0 }
            },
            event: {
                active: { type: Boolean, default: false },
                type: { type: String, default: '' },
                name: { type: String, default: '' },
                penaltyPercent: { type: Number, default: 0 },
                createdAt: { type: Number, default: 0 }
            }
        }],
        default: []
    },

    army: {
        archer: { type: Number, default: 0 },
        warrior: { type: Number, default: 0 },
        cavalry: { type: Number, default: 0 },
        catapult: { type: Number, default: 0 }
    },
    castleVictories: { type: Number, default: 0 },

    siegePreparations: {
        armyRations: { type: Boolean, default: false },
        warDrum: { type: Boolean, default: false },
        commanderEdict: { type: Boolean, default: false }
    },

    lastCastleLosses: {
        archer: { type: Number, default: 0 },
        warrior: { type: Number, default: 0 },
        cavalry: { type: Number, default: 0 },
        catapult: { type: Number, default: 0 },
        available: { type: Boolean, default: false }
    },

    bankDeposit: {
        principal: { type: Number, default: 0 },
        startedAt: { type: Number, default: 0 },
        maturesAt: { type: Number, default: 0 }
    },

    blacksmithMastery: {
        level: { type: Number, default: 1 },
        exp: { type: Number, default: 0 },
        ironOre: { type: Number, default: 0 }
    },

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
    inventory: { type: Array, default: [] },

    // ========================================================
    // MACERA / GÜNLÜK / SEZON / KOLEKSİYON PAKETİ V1
    // ========================================================
    adventureDailyKey: { type: String, default: '' },
    adventureDailyProgress: { type: Object, default: {} },
    adventureDailyClaims: { type: [String], default: [] },

    adventureWeeklyKey: { type: String, default: '' },
    adventureWeeklyProgress: { type: Object, default: {} },
    adventureWeeklyClaims: { type: [String], default: [] },

    achievementClaims: { type: [String], default: [] },

    treasureFragments: { type: Number, default: 0 },
    treasureChestsOpened: { type: Number, default: 0 },

    ownedMounts: { type: [String], default: [] },
    activeMount: { type: String, default: '' },
    ownedCompanions: { type: [String], default: [] },
    activeCompanion: { type: String, default: '' },

    peacefulResetDate: { type: String, default: '' },
    fishingAttemptsUsed: { type: Number, default: 0 },
    miningAttemptsUsed: { type: Number, default: 0 },
    fishCaught: { type: Number, default: 0 },
    oreMined: { type: Number, default: 0 },

    storyChapter: { type: Number, default: 1 },
    storyClaims: { type: [Number], default: [] },

    loginStreak: { type: Number, default: 0 },
    lastLoginDay: { type: String, default: '' },
    totalLoginDays: { type: Number, default: 0 },

    seasonKey: { type: String, default: '' },
    seasonPoints: { type: Number, default: 0 },
    seasonStats: { type: Object, default: {} },

    worldEventClaimKey: { type: String, default: '' },

    worldBossDayKey: { type: String, default: '' },
    worldBossAttackCount: { type: Number, default: 0 },
    worldBossLastAttackAt: { type: Number, default: 0 }
});

const User = mongoose.model('User', userSchema);

// Beypazarı Karakter Tezgahları Şeması
const stallSchema = new mongoose.Schema({
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true },
    characterName: { type: String, required: true },
    locationRank: { type: Number, default: 1 }, // 1: Ana Giriş (En İyi), 2: Orta Sokak, 3: Arka Sokak
    inventory: { type: Array, default: [] }, // [{ item, price, currency: 'gold' | 'ruby' }]
    gold: { type: Number, default: 0 }, // Tezgah kasasındaki biriken altın
    rubies: { type: Number, default: 0 } // Tezgah kasasındaki biriken yakut
});
const Stall = mongoose.model('Stall', stallSchema);

// ============================================================
// KLAN SİSTEMİ V1
// ============================================================
const CLAN_CREATE_COST = 10000;
const CLAN_BASE_MAX_MEMBERS = 15;
const CLAN_CHAT_HISTORY_LIMIT = 50;

// --- KLAN SEVİYESİ / GELİŞTİRME ---
const CLAN_MAX_LEVEL = 5;

const CLAN_LEVEL_DEFINITIONS = {
    1: { title: 'Oba', maxMembers: 15, castleDamageBonusPercent: 0, nextUpgradeCost: 25000, nextBenefit: 'Üye kapasitesi 20 olur.' },
    2: { title: 'Sancak', maxMembers: 20, castleDamageBonusPercent: 0, nextUpgradeCost: 50000, nextBenefit: 'Klan Kale Savaşı hasarı +%2 olur.' },
    3: { title: 'Beylik', maxMembers: 20, castleDamageBonusPercent: 2, nextUpgradeCost: 75000, nextBenefit: 'Üye kapasitesi 25 olur.' },
    4: { title: 'Hanedan', maxMembers: 25, castleDamageBonusPercent: 2, nextUpgradeCost: 100000, nextBenefit: 'Klan Büyük Hanedan unvanına ulaşır.' },
    5: { title: 'Büyük Hanedan', maxMembers: 25, castleDamageBonusPercent: 2, nextUpgradeCost: 0, nextBenefit: 'Maksimum klan seviyesi.' }
};

// --- KLAN KALE SAVAŞI V1 ---
// Türkiye saatiyle günde iki kez: 15:00 ve 21:00
// Her savaş penceresi 30 dakika sürer.
const CLAN_CASTLE_WAR_HOURS = [19];
const CLAN_CASTLE_WAR_DURATION_MINUTES = 30;
const CLAN_CASTLE_WAR_ATTACK_LIMIT = 5;
const CLAN_CASTLE_WAR_ATTACK_COOLDOWN_MS = 10 * 1000;
const CLAN_CASTLE_NAME = 'Hisar-ı Hümayun';

// Kale ele geçirme ödülleri
const CLAN_CASTLE_WIN_TREASURY_REWARD = 15000;
const CLAN_CASTLE_WIN_PARTICIPANT_HONOR = 30;
const CLAN_CASTLE_TOP_DAMAGE_HONOR_BONUS = 20;

const clanMemberSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['leader', 'officer', 'member'], default: 'member' },
    joinedAt: { type: Date, default: Date.now }
}, { _id: false });

const clanChatMessageSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    username: { type: String, required: true },
    message: { type: String, required: true, maxlength: 150 },
    createdAt: { type: Date, default: Date.now }
}, { _id: false });

const clanSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true, maxlength: 24 },
    nameKey: { type: String, required: true, unique: true, index: true },
    tag: { type: String, required: true, trim: true, maxlength: 5 },
    tagKey: { type: String, required: true, unique: true, index: true },
    leaderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    members: { type: [clanMemberSchema], default: [] },
    treasury: { type: Number, default: 0, min: 0 },
    level: { type: Number, default: 1, min: 1 },
    exp: { type: Number, default: 0, min: 0 },
    maxMembers: { type: Number, default: CLAN_BASE_MAX_MEMBERS },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    castleId: { type: String, default: null },
    chatMessages: { type: [clanChatMessageSchema], default: [] }
}, { timestamps: true });

const Clan = mongoose.model('Clan', clanSchema);

// ============================================================
// KLAN KALE SAVAŞI V1
// ============================================================
const clanCastleWarMemberSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    username: { type: String, required: true },
    damage: { type: Number, default: 0 },
    attacks: { type: Number, default: 0 },
    lastAttackAt: { type: Number, default: 0 }
}, { _id: false });

const clanCastleWarEntrySchema = new mongoose.Schema({
    clanId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clan', required: true },
    clanName: { type: String, required: true },
    clanTag: { type: String, required: true },
    totalDamage: { type: Number, default: 0 },
    attackCount: { type: Number, default: 0 },
    firstDamageAt: { type: Number, default: 0 },
    lastDamageAt: { type: Number, default: 0 },
    members: { type: [clanCastleWarMemberSchema], default: [] }
}, { _id: false });

const clanCastleWarSchema = new mongoose.Schema({
    warKey: { type: String, required: true, unique: true, index: true },
    startAt: { type: Number, required: true },
    endAt: { type: Number, required: true },
    finalized: { type: Boolean, default: false },
    finalizedAt: { type: Number, default: 0 },
    winnerClanId: { type: mongoose.Schema.Types.ObjectId, ref: 'Clan', default: null },
    winnerClanName: { type: String, default: '' },
    winnerClanTag: { type: String, default: '' },
    winningDamage: { type: Number, default: 0 },
    entries: { type: [clanCastleWarEntrySchema], default: [] }
}, { timestamps: true });

const ClanCastleWar = mongoose.model('ClanCastleWar', clanCastleWarSchema);

// Ana Kale / Taht durumu — tüm oyuncular için tek global kayıt
const castleSchema = new mongoose.Schema({
    key: { type: String, unique: true, default: 'main_castle' },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    ownerName: { type: String, default: '' },
    conqueredAt: { type: Number, default: 0 },
    battleCount: { type: Number, default: 0 }
});

const CastleState = mongoose.model('CastleState', castleSchema);

async function getOrCreateCastle() {
    return CastleState.findOneAndUpdate(
        { key: 'main_castle' },
        {
            $setOnInsert: {
                key: 'main_castle',
                ownerId: null,
                ownerName: '',
                conqueredAt: 0,
                battleCount: 0
            }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
}

async function getCastleStatusForUser(user) {
    let castle = await getOrCreateCastle();
    let defenderArmy = cloneArmy(NPC_CASTLE_ARMY);
    let defenderName = 'Saray Muhafızları';
    let defenderIsNpc = true;
    let defenderCommanderStr = 0;

    if (castle.ownerId) {
        const defenderUser = await User.findById(castle.ownerId);

        if (!defenderUser) {
            castle.ownerId = null;
            castle.ownerName = '';
            castle.conqueredAt = 0;
            await castle.save();
        } else {
            normalizeArmy(defenderUser);
            await defenderUser.save();

            defenderArmy = cloneArmy(defenderUser.army);
            defenderName = defenderUser.username;
            defenderIsNpc = false;

            // Kale sahibinin ekipman dahil toplam STR değeri ordusuna eklenir.
            defenderCommanderStr = getTotalStr(defenderUser);
        }
    }

    const troopPower = getArmyPower(defenderArmy);
    const combinedArmyPower = troopPower + defenderCommanderStr;

    const defensePower = Math.floor(
        (combinedArmyPower + CASTLE_WALL_POWER) * CASTLE_DEFENSE_BONUS
    );

    return {
        key: castle.key,
        ownerId: castle.ownerId ? String(castle.ownerId) : null,
        ownerName: castle.ownerName || '',
        defenderName,
        defenderIsNpc,
        defenderArmy,

        // Güç dökümü
        troopPower,
        commanderStr: defenderCommanderStr,
        armyPower: combinedArmyPower,
        wallPower: CASTLE_WALL_POWER,
        defensePower,
        defenseBonusPercent: Math.round((CASTLE_DEFENSE_BONUS - 1) * 100),

        conqueredAt: castle.conqueredAt || 0,
        battleCount: castle.battleCount || 0,
        isOwner: !!(
            castle.ownerId &&
            user &&
            String(castle.ownerId) === String(user._id)
        )
    };
}

function syncOnlineArmy(userId, army, noticeMessage = '') {
    for (const [socketId, onlineUser] of Object.entries(users)) {
        if (String(onlineUser._id) !== String(userId)) continue;

        if (!onlineUser.army) {
            onlineUser.army = { archer: 0, warrior: 0, cavalry: 0, catapult: 0 };
        }

        onlineUser.army.archer = army.archer || 0;
        onlineUser.army.warrior = army.warrior || 0;
        onlineUser.army.cavalry = army.cavalry || 0;
        onlineUser.army.catapult = army.catapult || 0;
        onlineUser.markModified('army');

        io.to(socketId).emit('statUpdated', onlineUser);

        if (noticeMessage) {
            io.to(socketId).emit('castleDefenseNotice', {
                message: noticeMessage
            });
        }
    }
}

let castleBattleLock = false;


const users = {};

function getOnlinePlayerCount() {
    const uniquePlayers = new Set();

    for (const onlineUser of Object.values(users)) {
        if (onlineUser?._id) {
            uniquePlayers.add(String(onlineUser._id));
        }
    }

    return uniquePlayers.size;
}

function broadcastOnlinePlayerCount() {
    io.emit('onlinePlayerCount', {
        count: getOnlinePlayerCount()
    });
}

function normalizeClanName(value) {
    return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
}

function getClanNameKey(value) {
    return normalizeClanName(value).toLocaleLowerCase('tr-TR');
}

function normalizeClanTag(value) {
    return String(value || '').normalize('NFKC').trim().toLocaleUpperCase('tr-TR');
}

function isValidClanName(name) {
    return /^[A-Za-z0-9ÇĞİÖŞÜçğıöşü ]{3,24}$/u.test(name);
}

function isValidClanTag(tag) {
    return /^[A-Z0-9ÇĞİÖŞÜ]{2,5}$/u.test(tag);
}

function getClanLevelState(clan) {
    const rawLevel = Math.max(1, Math.min(CLAN_MAX_LEVEL, Number.parseInt(clan?.level, 10) || 1));
    const definition = CLAN_LEVEL_DEFINITIONS[rawLevel] || CLAN_LEVEL_DEFINITIONS[1];

    return {
        level: rawLevel,
        maxLevel: CLAN_MAX_LEVEL,
        title: definition.title,
        maxMembers: definition.maxMembers,
        castleDamageBonusPercent: definition.castleDamageBonusPercent,
        nextUpgradeCost: rawLevel >= CLAN_MAX_LEVEL ? 0 : definition.nextUpgradeCost,
        nextBenefit: definition.nextBenefit,
        isMaxLevel: rawLevel >= CLAN_MAX_LEVEL
    };
}

function getClanMemberPower(user) {
    if (!user) {
        return { totalStr: 5, totalVit: 5, power: 15 };
    }

    const totalStr = getTotalStr(user);
    const totalVit = getTotalVit(user);
    const power = getCharacterCombatPower(user);

    return { totalStr, totalVit, power };
}

function isUserOnline(userId) {
    const targetId = String(userId);
    return Object.values(users).some(
        onlineUser => onlineUser && String(onlineUser._id) === targetId
    );
}

function syncOnlineUserClan(userId, clanId, role) {
    const targetId = String(userId);

    for (const onlineUser of Object.values(users)) {
        if (!onlineUser || String(onlineUser._id) !== targetId) continue;
        onlineUser.clanId = clanId || null;
        onlineUser.clanRole = role || null;
    }
}

function emitToOnlineUser(userId, eventName, payload) {
    const targetId = String(userId);

    for (const [socketId, onlineUser] of Object.entries(users)) {
        if (!onlineUser || String(onlineUser._id) !== targetId) continue;
        io.to(socketId).emit(eventName, payload);
    }
}


function syncOnlineHonorRewardState(updatedUser) {
    if (!updatedUser?._id) return;

    const id = String(updatedUser._id);

    for (const [socketId, onlineUser] of Object.entries(users)) {
        if (String(onlineUser?._id) !== id) continue;

        onlineUser.honor = Math.max(0, Number(updatedUser.honor) || 0);
        onlineUser.rubies = Math.max(0, Number(updatedUser.rubies) || 0);
        onlineUser.honorRubyMilestone = Math.max(
            0,
            Number(updatedUser.honorRubyMilestone) || 0
        );
        onlineUser.honorRewardInitialized = Boolean(
            updatedUser.honorRewardInitialized
        );

        io.to(socketId).emit('statUpdated', onlineUser);
    }
}

function broadcastClanRefresh(clanId, message = '') {
    if (!clanId) return;
    const targetClanId = String(clanId);

    for (const [socketId, onlineUser] of Object.entries(users)) {
        if (!onlineUser?.clanId) continue;
        if (String(onlineUser.clanId) !== targetClanId) continue;

        io.to(socketId).emit('clanRefresh', {
            message: String(message || '').substring(0, 180)
        });
    }
}

async function buildClanPayload(clan, requestingUser) {
    if (!clan) return null;

    const memberIds = (clan.members || []).map(member => member.userId);

    const memberUsers = memberIds.length > 0
        ? await User.find({ _id: { $in: memberIds } })
            .select('username level str vit equipped honor clanContribution')
            .lean()
        : [];

    const userMap = new Map(
        memberUsers.map(memberUser => [String(memberUser._id), memberUser])
    );

    const members = (clan.members || []).map(member => {
        const memberUser = userMap.get(String(member.userId));
        const stats = getClanMemberPower(memberUser || null);

        return {
            userId: String(member.userId),
            username: memberUser?.username || 'Bilinmeyen Oyuncu',
            level: Math.max(1, Number(memberUser?.level) || 1),
            honor: Math.max(0, Number(memberUser?.honor) || 0),
            contribution: Math.max(0, Number(memberUser?.clanContribution) || 0),
            role: member.role || 'member',
            joinedAt: member.joinedAt,
            totalStr: stats.totalStr,
            totalVit: stats.totalVit,
            power: stats.power,
            online: isUserOnline(member.userId)
        };
    });

    const roleOrder = { leader: 0, officer: 1, member: 2 };

    members.sort((a, b) => {
        const roleDifference =
            (roleOrder[a.role] ?? 9) -
            (roleOrder[b.role] ?? 9);

        if (roleDifference !== 0) return roleDifference;
        return b.power - a.power;
    });

    const clanLevelState = getClanLevelState(clan);

    return {
        _id: String(clan._id),
        name: clan.name,
        tag: clan.tag,
        leaderId: String(clan.leaderId),
        treasury: Math.max(0, Number(clan.treasury) || 0),
        level: clanLevelState.level,
        maxLevel: clanLevelState.maxLevel,
        rankTitle: clanLevelState.title,
        castleDamageBonusPercent: clanLevelState.castleDamageBonusPercent,
        nextUpgradeCost: clanLevelState.nextUpgradeCost,
        nextLevelBenefit: clanLevelState.nextBenefit,
        isMaxLevel: clanLevelState.isMaxLevel,
        exp: Math.max(0, Number(clan.exp) || 0),
        maxMembers: clanLevelState.maxMembers,
        memberCount: members.length,
        wins: Math.max(0, Number(clan.wins) || 0),
        losses: Math.max(0, Number(clan.losses) || 0),
        castleId: clan.castleId || null,
        myRole: requestingUser?.clanRole || 'member',
        members,
        chatMessages: (clan.chatMessages || [])
            .slice(-CLAN_CHAT_HISTORY_LIMIT)
            .map(chatMessage => ({
                userId: String(chatMessage.userId),
                username: chatMessage.username,
                message: chatMessage.message,
                createdAt: chatMessage.createdAt
            }))
    };
}

async function sendClanData(socket, user) {
    if (!user?.clanId) {
        socket.emit('clanData', {
            clan: null,
            userData: user || null
        });
        return;
    }

    const clan = await Clan.findById(user.clanId);

    if (!clan) {
        user.clanId = null;
        user.clanRole = null;
        await user.save();

        socket.emit('clanData', {
            clan: null,
            userData: user
        });
        return;
    }

    const membership = (clan.members || []).find(
        member => String(member.userId) === String(user._id)
    );

    if (!membership) {
        user.clanId = null;
        user.clanRole = null;
        await user.save();

        socket.emit('clanData', {
            clan: null,
            userData: user
        });
        return;
    }

    if (user.clanRole !== membership.role) {
        user.clanRole = membership.role;
        await user.save();
    }

    socket.emit('clanData', {
        clan: await buildClanPayload(clan, user),
        userData: user
    });
}


const TURKEY_OFFSET_MS = 3 * 60 * 60 * 1000;

function getClanCastleWarWindow(now = Date.now()) {
    // Türkiye UTC+3. Savaşlar 15:00 ve 21:00'de açılır.
    const shifted = new Date(now + TURKEY_OFFSET_MS);
    const year = shifted.getUTCFullYear();
    const month = shifted.getUTCMonth();
    const day = shifted.getUTCDate();

    const makeSlot = (slotYear, slotMonth, slotDay, slotHour) => {
        const startAt = Date.UTC(slotYear, slotMonth, slotDay, slotHour, 0, 0, 0) - TURKEY_OFFSET_MS;
        const endAt = startAt + (CLAN_CASTLE_WAR_DURATION_MINUTES * 60 * 1000);
        const localStart = new Date(startAt + TURKEY_OFFSET_MS);
        const warKey = [
            localStart.getUTCFullYear(),
            String(localStart.getUTCMonth() + 1).padStart(2, '0'),
            String(localStart.getUTCDate()).padStart(2, '0'),
            String(localStart.getUTCHours()).padStart(2, '0')
        ].join('-');
        return { warKey, startAt, endAt };
    };

    const todaySlots = CLAN_CASTLE_WAR_HOURS.map(hour => makeSlot(year, month, day, hour));
    const activeSlot = todaySlots.find(slot => now >= slot.startAt && now < slot.endAt) || null;

    if (activeSlot) {
        return { ...activeSlot, active: true, nextStartAt: activeSlot.startAt };
    }

    let nextSlot = todaySlots.find(slot => slot.startAt > now) || null;
    if (!nextSlot) {
        const tomorrow = new Date(Date.UTC(year, month, day + 1, 0, 0, 0, 0));
        nextSlot = makeSlot(
            tomorrow.getUTCFullYear(),
            tomorrow.getUTCMonth(),
            tomorrow.getUTCDate(),
            CLAN_CASTLE_WAR_HOURS[0]
        );
    }

    return { ...nextSlot, active: false, nextStartAt: nextSlot.startAt };
}

function sortClanCastleWarEntries(entries = []) {
    return [...entries].sort((a, b) => {
        const damageDiff =
            (Number(b.totalDamage) || 0) -
            (Number(a.totalDamage) || 0);

        if (damageDiff !== 0) return damageDiff;

        const aFirst = Number(a.firstDamageAt) || Number.MAX_SAFE_INTEGER;
        const bFirst = Number(b.firstDamageAt) || Number.MAX_SAFE_INTEGER;

        return aFirst - bFirst;
    });
}

async function ensureClanCastleWar(windowInfo) {
    if (!windowInfo?.warKey) return null;

    return ClanCastleWar.findOneAndUpdate(
        { warKey: windowInfo.warKey },
        {
            $setOnInsert: {
                warKey: windowInfo.warKey,
                startAt: windowInfo.startAt,
                endAt: windowInfo.endAt,
                finalized: false,
                entries: []
            }
        },
        {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true
        }
    );
}

async function getCurrentClanCastleOwner() {
    const ownerClan = await Clan.findOne({
        castleId: CLAN_CASTLE_NAME
    })
        .select('name tag')
        .lean();

    if (!ownerClan) return null;

    return {
        clanId: String(ownerClan._id),
        clanName: ownerClan.name,
        clanTag: ownerClan.tag
    };
}

async function finalizeClanCastleWar(war) {
    if (!war || war.finalized) return war;

    const leaderboard =
        sortClanCastleWarEntries(war.entries || []);

    const winner =
        leaderboard.length > 0 &&
        (Number(leaderboard[0].totalDamage) || 0) > 0
            ? leaderboard[0]
            : null;

    // Aynı savaşın iki kez sonuçlandırılmasını engelle.
    const claimed = await ClanCastleWar.findOneAndUpdate(
        {
            _id: war._id,
            finalized: false
        },
        {
            $set: {
                finalized: true,
                finalizedAt: Date.now(),
                winnerClanId: winner?.clanId || null,
                winnerClanName: winner?.clanName || '',
                winnerClanTag: winner?.clanTag || '',
                winningDamage: Number(winner?.totalDamage) || 0
            }
        },
        { new: true }
    );

    if (!claimed) {
        return ClanCastleWar.findById(war._id);
    }

    if (winner) {
        // Önce eski sahibin kale işaretini kaldır.
        await Clan.updateMany(
            {
                castleId: CLAN_CASTLE_NAME,
                _id: { $ne: winner.clanId }
            },
            {
                $set: { castleId: null }
            }
        );

        // Kazanan klana kale + galibiyet + klan hazinesi ödülü.
        await Clan.updateOne(
            { _id: winner.clanId },
            {
                $set: { castleId: CLAN_CASTLE_NAME },
                $inc: {
                    wins: 1,
                    treasury: CLAN_CASTLE_WIN_TREASURY_REWARD
                }
            }
        );

        // Kazanan klanın savaşa gerçekten katılan üyelerine Onur ver.
        // En fazla hasarı veren üye ayrıca bonus Onur kazanır.
        const winningParticipants = (winner.members || [])
            .filter(member => (Number(member.attacks) || 0) > 0)
            .sort((a, b) => (Number(b.damage) || 0) - (Number(a.damage) || 0));

        const topDamageUserId = winningParticipants[0]?.userId
            ? String(winningParticipants[0].userId)
            : null;

        if (winningParticipants.length > 0) {
            const participantIds = winningParticipants.map(member => member.userId);
            const participantUsers = await User.find({
                _id: { $in: participantIds }
            });

            for (const participantUser of participantUsers) {
                const isTopDamage =
                    topDamageUserId &&
                    String(participantUser._id) === topDamageUserId;

                const honorAmount =
                    CLAN_CASTLE_WIN_PARTICIPANT_HONOR +
                    (isTopDamage ? CLAN_CASTLE_TOP_DAMAGE_HONOR_BONUS : 0);

                const honorReward = applyHonorChange(
                    participantUser,
                    honorAmount
                );

                await participantUser.save();
                syncOnlineHonorRewardState(participantUser);

                const rubyText = honorReward.rubyReward > 0
                    ? ` 💎 Onur eşiği ödülü: +${honorReward.rubyReward} Yakut!`
                    : '';

                emitToOnlineUser(
                    participantUser._id,
                    'clanCastleReward',
                    {
                        success: true,
                        userData: participantUser,
                        message:
                            `🏰 ${CLAN_CASTLE_NAME} klanınız tarafından ele geçirildi! ` +
                            `+${honorAmount} Onur 🌟` +
                            (isTopDamage ? ' (En Yüksek Hasar Bonusu dahil)' : '') +
                            rubyText
                    }
                );
            }
        }

        // Savaşa katılan diğer klanlara mağlubiyet.
        const loserIds = leaderboard
            .slice(1)
            .map(entry => entry.clanId)
            .filter(Boolean);

        if (loserIds.length > 0) {
            await Clan.updateMany(
                { _id: { $in: loserIds } },
                { $inc: { losses: 1 } }
            );
        }

        broadcastClanRefresh(
            winner.clanId,
            `🏰 ${CLAN_CASTLE_NAME} ele geçirildi! ` +
            `Klan hazinesine +${CLAN_CASTLE_WIN_TREASURY_REWARD.toLocaleString('tr-TR')} Altın, ` +
            `katılan üyelere +${CLAN_CASTLE_WIN_PARTICIPANT_HONOR} Onur verildi.`
        );
    }

    io.emit('clanCastleWarRefresh', {
        warKey: claimed.warKey,
        finalized: true
    });

    return claimed;
}

async function finalizeExpiredClanCastleWars() {
    const now = Date.now();

    const expired = await ClanCastleWar.find({
        finalized: false,
        endAt: { $lte: now }
    }).limit(20);

    for (const war of expired) {
        try {
            await finalizeClanCastleWar(war);
        } catch (err) {
            console.error(
                'Klan Kale Savaşı sonuçlandırma hatası:',
                err
            );
        }
    }
}

async function buildClanCastleWarStatus(user) {
    await finalizeExpiredClanCastleWars();

    const now = Date.now();
    const windowInfo = getClanCastleWarWindow(now);

    let activeWar = null;

    if (windowInfo.active) {
        activeWar = await ensureClanCastleWar(windowInfo);
    }

    const lastWar = await ClanCastleWar.findOne({
        finalized: true
    })
        .sort({ endAt: -1 })
        .lean();

    const sourceWar = activeWar || lastWar || null;

    let leaderboard = [];
    let myClanEntry = null;
    let myMemberEntry = null;

    if (sourceWar) {
        leaderboard = sortClanCastleWarEntries(
            sourceWar.entries || []
        ).map((entry, index) => ({
            rank: index + 1,
            clanId: String(entry.clanId),
            clanName: entry.clanName,
            clanTag: entry.clanTag,
            totalDamage: Math.max(
                0,
                Number(entry.totalDamage) || 0
            ),
            attackCount: Math.max(
                0,
                Number(entry.attackCount) || 0
            )
        }));
    }

    if (activeWar && user?.clanId) {
        myClanEntry = (activeWar.entries || []).find(
            entry =>
                String(entry.clanId) ===
                String(user.clanId)
        ) || null;

        if (myClanEntry) {
            myMemberEntry =
                (myClanEntry.members || []).find(
                    member =>
                        String(member.userId) ===
                        String(user._id)
                ) || null;
        }
    }

    const owner = await getCurrentClanCastleOwner();

    const myAttackCount =
        Math.max(
            0,
            Number(myMemberEntry?.attacks) || 0
        );

    const lastAttackAt =
        Math.max(
            0,
            Number(myMemberEntry?.lastAttackAt) || 0
        );

    const cooldownRemainingMs =
        lastAttackAt > 0
            ? Math.max(
                0,
                CLAN_CASTLE_WAR_ATTACK_COOLDOWN_MS -
                (now - lastAttackAt)
            )
            : 0;

    const characterPower =
        user
            ? getCharacterCombatPower(user)
            : 0;

    const armyPower =
        user
            ? getArmyPower(user.army)
            : 0;

    const setBonus =
        user
            ? getHukumdarSetBonusState(user)
            : { castleAttackPercent: 0 };

    const warClan =
        user?.clanId
            ? await Clan.findById(user.clanId).select('level').lean()
            : null;

    const clanLevelState = getClanLevelState(warClan);

    return {
        castleName: CLAN_CASTLE_NAME,
        active: Boolean(windowInfo.active),
        warKey: windowInfo.warKey,
        startAt: windowInfo.startAt,
        endAt: windowInfo.endAt,
        nextStartAt: windowInfo.active
            ? windowInfo.endAt
            : windowInfo.nextStartAt,
        scheduleHours: CLAN_CASTLE_WAR_HOURS,
        durationMinutes: CLAN_CASTLE_WAR_DURATION_MINUTES,
        attackLimit: CLAN_CASTLE_WAR_ATTACK_LIMIT,
        attackCooldownMs: CLAN_CASTLE_WAR_ATTACK_COOLDOWN_MS,
        owner,
        leaderboard,
        myClanDamage: Math.max(
            0,
            Number(myClanEntry?.totalDamage) || 0
        ),
        myDamage: Math.max(
            0,
            Number(myMemberEntry?.damage) || 0
        ),
        myAttacksUsed: myAttackCount,
        myAttacksRemaining: Math.max(
            0,
            CLAN_CASTLE_WAR_ATTACK_LIMIT -
            myAttackCount
        ),
        cooldownRemainingMs,
        characterPower,
        armyPower,
        castleAttackBonusPercent:
            Number(setBonus.castleAttackPercent) || 0,
        clanCastleDamageBonusPercent:
            clanLevelState.castleDamageBonusPercent,
        rewards: {
            winnerTreasuryGold: CLAN_CASTLE_WIN_TREASURY_REWARD,
            participantHonor: CLAN_CASTLE_WIN_PARTICIPANT_HONOR,
            topDamageHonorBonus: CLAN_CASTLE_TOP_DAMAGE_HONOR_BONUS,
            honorStep: HONOR_RUBY_STEP,
            honorRubyReward: HONOR_RUBY_REWARD
        },
        canAttack:
            Boolean(
                windowInfo.active &&
                user?.clanId &&
                myAttackCount <
                    CLAN_CASTLE_WAR_ATTACK_LIMIT &&
                cooldownRemainingMs <= 0
            ),
        lastWar: lastWar
            ? {
                warKey: lastWar.warKey,
                startAt: lastWar.startAt,
                endAt: lastWar.endAt,
                winnerClanId: lastWar.winnerClanId
                    ? String(lastWar.winnerClanId)
                    : null,
                winnerClanName:
                    lastWar.winnerClanName || '',
                winnerClanTag:
                    lastWar.winnerClanTag || '',
                winningDamage:
                    Math.max(
                        0,
                        Number(lastWar.winningDamage) || 0
                    )
            }
            : null
    };
}


function getRequestBearerToken(req) {
    const auth = String(req.headers?.authorization || '');
    if (auth.toLowerCase().startsWith('bearer ')) {
        return auth.slice(7).trim();
    }
    return String(req.headers?.['x-auth-token'] || '').trim();
}

function safeUserForClient(user) {
    if (!user) return null;
    const obj = typeof user.toObject === 'function' ? user.toObject() : { ...user };
    delete obj.password;
    delete obj.token;
    return obj;
}

// Backend'in gerçekten hangi sürümde çalıştığını tarayıcıdan kontrol etmek için.
app.get('/api/build', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
        ok: true,
        build: GAME_BUILD_ID,
        clanV1: true,
        clanCastleWarV1: true,
        honorRubyRewards: true,
        catapult: true,
        onlineCounter: true,
        adventurePackV1: true,
        worldBossV1: true,
        seasonV1: true,
        mongoReadyState: mongoose.connection.readyState
    });
});

// Socket.IO klan cevabı herhangi bir nedenle gelmezse güvenli HTTP fallback.
app.get('/api/clan-data', async (req, res) => {
    res.set('Cache-Control', 'no-store');

    try {
        const token = getRequestBearerToken(req);
        if (!token) {
            return res.status(401).json({
                ok: false,
                error: 'Oturum anahtarı bulunamadı.'
            });
        }

        const user = await User.findOne({ token });
        if (!user) {
            return res.status(401).json({
                ok: false,
                error: 'Oturum geçersiz veya süresi dolmuş.'
            });
        }

        if (!user.clanId) {
            return res.json({
                ok: true,
                clan: null,
                userData: safeUserForClient(user)
            });
        }

        const clan = await Clan.findById(user.clanId);

        if (!clan) {
            user.clanId = null;
            user.clanRole = null;
            await user.save();

            return res.json({
                ok: true,
                clan: null,
                userData: safeUserForClient(user)
            });
        }

        const membership = (clan.members || []).find(
            member => String(member.userId) === String(user._id)
        );

        if (!membership) {
            user.clanId = null;
            user.clanRole = null;
            await user.save();

            return res.json({
                ok: true,
                clan: null,
                userData: safeUserForClient(user)
            });
        }

        if (user.clanRole !== membership.role) {
            user.clanRole = membership.role;
            await user.save();
        }

        return res.json({
            ok: true,
            clan: await buildClanPayload(clan, user),
            userData: safeUserForClient(user)
        });
    } catch (err) {
        console.error('GET /api/clan-data hatası:', err);
        return res.status(500).json({
            ok: false,
            error: 'Klan bilgileri HTTP üzerinden yüklenemedi.'
        });
    }
});

app.get('/api/clan-list', async (req, res) => {
    res.set('Cache-Control', 'no-store');

    try {
        const clans = await Clan.find({})
            .select('name tag level treasury members maxMembers wins losses')
            .sort({ level: -1, treasury: -1, createdAt: 1 })
            .limit(50)
            .lean();

        return res.json({
            ok: true,
            clans: clans.map(clan => {
                const levelState = getClanLevelState(clan);
                return {
                    _id: String(clan._id),
                    name: clan.name,
                    tag: clan.tag,
                    level: levelState.level,
                    rankTitle: levelState.title,
                    treasury: Math.max(0, Number(clan.treasury) || 0),
                    memberCount: Array.isArray(clan.members) ? clan.members.length : 0,
                    maxMembers: levelState.maxMembers,
                    wins: Math.max(0, Number(clan.wins) || 0),
                    losses: Math.max(0, Number(clan.losses) || 0)
                };
            })
        });
    } catch (err) {
        console.error('GET /api/clan-list hatası:', err);
        return res.status(500).json({
            ok: false,
            clans: [],
            error: 'Klan listesi HTTP üzerinden yüklenemedi.'
        });
    }
});

const rateLimits = {};
function checkRateLimit(socketId) {
    const now = Date.now();
    if (rateLimits[socketId] && now - rateLimits[socketId] < 800) {
        return false;
    }
    rateLimits[socketId] = now;
    return true;
}

const getDefaultInventory = () => [
    { id: 'item_1', name: 'Tahta Kılıç', icon: '🗡️', type: 'weapon', strBonus: 3, vitBonus: 0, level: 0, rarity: 'Sıradan' },
    { id: 'item_2', name: 'Deri Zırh', icon: '🛡️', type: 'armor', strBonus: 0, vitBonus: 5, level: 0, rarity: 'Sıradan' }
];


// ============================================================================
// MACERA PAKETİ V1
// Günlük/Haftalık Görevler • Başarımlar • Koleksiyon • Dünya Bossu
// Dünya Olayları • Hazine Haritası • Binek/Yoldaş • Balık/Maden
// Hikâye Zinciri • Sezon • Giriş Serisi • Dünya Akışı
// ============================================================================

const ADVENTURE_DAILY_TASKS = [
    {
        id: 'daily_quest',
        icon: '⚔️',
        name: 'Sefer Ustası',
        description: '3 İş / Sefer görevi tamamla.',
        action: 'quest',
        target: 3,
        reward: { gold: 300 }
    },
    {
        id: 'daily_dungeon',
        icon: '🌋',
        name: 'Zindan Nöbeti',
        description: '3 gerçek Zindan saldırısı yap.',
        action: 'dungeon_attack',
        target: 3,
        reward: { gold: 350 }
    },
    {
        id: 'daily_metin',
        icon: '🪨',
        name: 'Taş Kıran',
        description: '1 Metin Taşı parçala.',
        action: 'metin_kill',
        target: 1,
        reward: { fragments: 1 }
    },
    {
        id: 'daily_arena',
        icon: '🏟️',
        name: 'Arena Galibi',
        description: '1 Arena zaferi kazan.',
        action: 'arena_win',
        target: 1,
        reward: { honor: 5 }
    },
    {
        id: 'daily_army',
        icon: '🪖',
        name: 'Ordu Hazırlığı',
        description: 'Toplam 20 birlik üret veya Mancınık inşa et.',
        action: 'train_troop',
        target: 20,
        reward: { gold: 450 }
    }
];

const ADVENTURE_WEEKLY_TASKS = [
    {
        id: 'weekly_quest',
        icon: '📜',
        name: 'Haftalık Sefer',
        description: '20 görev tamamla.',
        action: 'quest',
        target: 20,
        reward: { gold: 2000 }
    },
    {
        id: 'weekly_metin',
        icon: '🪨',
        name: 'Metin Avcısı',
        description: '10 Metin Taşı parçala.',
        action: 'metin_kill',
        target: 10,
        reward: { fragments: 2 }
    },
    {
        id: 'weekly_arena',
        icon: '⚔️',
        name: 'Kolosseum Şampiyonu',
        description: '10 Arena zaferi kazan.',
        action: 'arena_win',
        target: 10,
        reward: { honor: 20 }
    },
    {
        id: 'weekly_dungeon',
        icon: '🐉',
        name: 'Zindan Temizliği',
        description: '15 gerçek Zindan saldırısı yap.',
        action: 'dungeon_attack',
        target: 15,
        reward: { rubies: 3 }
    },
    {
        id: 'weekly_clanwar',
        icon: '🏰',
        name: 'Hisar Akıncısı',
        description: 'Klan Kale Savaşında 10 saldırı yap.',
        action: 'clan_war_attack',
        target: 10,
        reward: { honor: 15, fragments: 1 }
    }
];

const ADVENTURE_MOUNTS = {
    steppe_horse: {
        key: 'steppe_horse',
        icon: '🐎',
        name: 'Bozkır Atı',
        description: 'Hikâyenin ilk bölümünden kazanılır.',
        combatBonusPercent: 1
    },
    war_horse: {
        key: 'war_horse',
        icon: '🏇',
        name: 'Savaş Atı',
        description: 'Başarımlardan veya Hazine Sandığından çıkabilir.',
        combatBonusPercent: 2
    },
    black_stallion: {
        key: 'black_stallion',
        icon: '♞',
        name: 'Kara Aygır',
        description: 'İleri hikâye ödülüdür.',
        combatBonusPercent: 3
    }
};

const ADVENTURE_COMPANIONS = {
    falcon: {
        key: 'falcon',
        icon: '🦅',
        name: 'Saray Şahini',
        description: 'Hikâye zincirinde kazanılır.',
        combatBonusPercent: 1
    },
    wolf: {
        key: 'wolf',
        icon: '🐺',
        name: 'Bozkurt',
        description: 'Hazine Sandığından nadiren çıkabilir.',
        combatBonusPercent: 2
    },
    lion: {
        key: 'lion',
        icon: '🦁',
        name: 'Aslan Yoldaş',
        description: 'İleri başarım ödülüdür.',
        combatBonusPercent: 3
    }
};

const ADVENTURE_ACHIEVEMENTS = [
    {
        id: 'ach_first_metin',
        icon: '🪨',
        name: 'İlk Metin',
        description: 'İlk Metin Taşını parçala.',
        targetText: '1 Metin',
        unlocked: user => (Number(user.metinKills) || 0) >= 1,
        progress: user => `${Math.min(1, Number(user.metinKills) || 0)}/1`,
        reward: { gold: 500 }
    },
    {
        id: 'ach_metin_25',
        icon: '💥',
        name: 'Metin Celladı',
        description: '25 Metin Taşı parçala.',
        targetText: '25 Metin',
        unlocked: user => (Number(user.metinKills) || 0) >= 25,
        progress: user => `${Math.min(25, Number(user.metinKills) || 0)}/25`,
        reward: { fragments: 2 }
    },
    {
        id: 'ach_arena_25',
        icon: '🏟️',
        name: 'Arena Kumandanı',
        description: '25 Arena zaferi kazan.',
        targetText: '25 Arena Zaferi',
        unlocked: user => (Number(user.arenaWins) || 0) >= 25,
        progress: user => `${Math.min(25, Number(user.arenaWins) || 0)}/25`,
        reward: { honor: 25 }
    },
    {
        id: 'ach_dungeon_boss',
        icon: '🐉',
        name: 'Boss Avcısı',
        description: '10. Kat Zindan Bossunu yen.',
        targetText: '1 Final Boss',
        unlocked: user => (Number(user.dungeonBossWins) || 0) >= 1,
        progress: user => `${Math.min(1, Number(user.dungeonBossWins) || 0)}/1`,
        reward: { fragments: 2 }
    },
    {
        id: 'ach_castle',
        icon: '👑',
        name: 'Taht Fatihi',
        description: 'Bireysel Taht Kalesini en az bir kez ele geçir.',
        targetText: '1 Fetih',
        unlocked: user => (Number(user.castleVictories) || 0) >= 1,
        progress: user => `${Math.min(1, Number(user.castleVictories) || 0)}/1`,
        reward: { mount: 'war_horse' }
    },
    {
        id: 'ach_catapult_100',
        icon: '🪵',
        name: 'Kuşatma Ustası',
        description: 'Orduda 100 Mancınığa ulaş.',
        targetText: '100 Mancınık',
        unlocked: user => (Number(user.army?.catapult) || 0) >= 100,
        progress: user => `${Math.min(100, Number(user.army?.catapult) || 0)}/100`,
        reward: { fragments: 3 }
    },
    {
        id: 'ach_honor_500',
        icon: '🌟',
        name: 'Şerefli Kumandan',
        description: '500 Onura ulaş.',
        targetText: '500 Onur',
        unlocked: user => (Number(user.honor) || 0) >= 500,
        progress: user => `${Math.min(500, Number(user.honor) || 0)}/500`,
        reward: { companion: 'lion' }
    },
    {
        id: 'ach_hukumdar_8',
        icon: '✨',
        name: 'Hükümdarın Kudreti',
        description: '8 Hükümdar Seti parçasını aynı anda kuşan.',
        targetText: '8 Parça',
        unlocked: user => getHukumdarSetEquippedCount(user) >= 8,
        progress: user => `${Math.min(8, getHukumdarSetEquippedCount(user))}/8`,
        reward: { honor: 50, rubies: 5 }
    }
];

const ADVENTURE_COLLECTION = [
    {
        id: 'col_first_quest', icon: '📜', name: 'İlk Sefer',
        description: 'İlk görevini tamamla.',
        unlocked: user => (Number(user.seasonStats?.quest) || 0) >= 1 || (Number(user.level) || 1) > 1
    },
    {
        id: 'col_metin', icon: '🪨', name: 'Metin Taşları',
        description: 'Bir Metin Taşı parçala.',
        unlocked: user => (Number(user.metinKills) || 0) >= 1
    },
    {
        id: 'col_dungeon', icon: '🌋', name: 'Zindan Adası',
        description: 'Zindan sisteminde ilerle.',
        unlocked: user => (Number(user.dungeonFloor) || 1) >= 2
    },
    {
        id: 'col_final_boss', icon: '🐉', name: 'Final Boss',
        description: '10. Kat Bossunu yen.',
        unlocked: user => (Number(user.dungeonBossWins) || 0) >= 1
    },
    {
        id: 'col_arena', icon: '🏟️', name: 'Kolosseum',
        description: 'Arena zaferi kazan.',
        unlocked: user => (Number(user.arenaWins) || 0) >= 1
    },
    {
        id: 'col_timar', icon: '🌾', name: 'Tımar Sahibi',
        description: 'En az bir Tımar satın al.',
        unlocked: user => Array.isArray(user.estates) && user.estates.length >= 1
    },
    {
        id: 'col_catapult', icon: '🪵', name: 'Mancınık',
        description: 'İlk Mancınığını inşa et.',
        unlocked: user => (Number(user.army?.catapult) || 0) >= 1
    },
    {
        id: 'col_clan', icon: '🛡️', name: 'Klan Sancağı',
        description: 'Bir klana katıl.',
        unlocked: user => Boolean(user.clanId)
    },
    {
        id: 'col_castle', icon: '👑', name: 'Taht Kalesi',
        description: 'Kaleyi bir kez fethet.',
        unlocked: user => (Number(user.castleVictories) || 0) >= 1
    },
    {
        id: 'col_hukumdar_2', icon: '✨', name: 'Hükümdar Seti II',
        description: '2 Hükümdar Seti parçası kuşan.',
        unlocked: user => getHukumdarSetEquippedCount(user) >= 2
    },
    {
        id: 'col_hukumdar_4', icon: '🌟', name: 'Hükümdar Seti IV',
        description: '4 Hükümdar Seti parçası kuşan.',
        unlocked: user => getHukumdarSetEquippedCount(user) >= 4
    },
    {
        id: 'col_hukumdar_8', icon: '👑', name: 'Tam Hükümdar Seti',
        description: '8 parçayı aynı anda kuşan.',
        unlocked: user => getHukumdarSetEquippedCount(user) >= 8
    },
    {
        id: 'col_fisher', icon: '🎣', name: 'Balıkçı',
        description: '10 kez balık tut.',
        unlocked: user => (Number(user.fishCaught) || 0) >= 10
    },
    {
        id: 'col_miner', icon: '⛏️', name: 'Madenci',
        description: '20 cevher çıkar.',
        unlocked: user => (Number(user.oreMined) || 0) >= 20
    },
    {
        id: 'col_treasure', icon: '🗺️', name: 'Hazine Avcısı',
        description: 'İlk Hazine Sandığını aç.',
        unlocked: user => (Number(user.treasureChestsOpened) || 0) >= 1
    },
    {
        id: 'col_worldboss', icon: '👹', name: 'Dünya Bossu',
        description: 'Dünya Bossuna en az bir saldırı yap.',
        unlocked: user => (Number(user.seasonStats?.world_boss_attack) || 0) >= 1
    }
];

const ADVENTURE_STORY = [
    {
        chapter: 1,
        title: 'Sancağın Doğuşu',
        description: 'Seviye 5 ol ve saraydan ilk resmi görevini al.',
        requirementText: 'Seviye 5',
        ready: user => (Number(user.level) || 1) >= 5,
        reward: { gold: 750, mount: 'steppe_horse' }
    },
    {
        chapter: 2,
        title: 'Karanlık Taşlar',
        description: 'Metinlerin kaynağını araştırmak için 3 Metin parçala.',
        requirementText: '3 Metin parçala',
        ready: user => (Number(user.metinKills) || 0) >= 3,
        reward: { fragments: 2 }
    },
    {
        chapter: 3,
        title: 'Zindan Fısıltıları',
        description: 'Zindan Adasında en az 3. kata ulaş.',
        requirementText: 'Zindan Katı 3',
        ready: user => (Number(user.dungeonFloor) || 1) >= 3,
        reward: { companion: 'falcon', gold: 1000 }
    },
    {
        chapter: 4,
        title: 'Kolosseum Kanı',
        description: 'Arena’da 5 zafer kazan ve adını duyur.',
        requirementText: '5 Arena zaferi',
        ready: user => (Number(user.arenaWins) || 0) >= 5,
        reward: { honor: 15 }
    },
    {
        chapter: 5,
        title: 'Birlik Sancağı',
        description: 'Bir klana katıl veya kendi klanını kur.',
        requirementText: 'Bir klana üye ol',
        ready: user => Boolean(user.clanId),
        reward: { gold: 1500, fragments: 1 }
    },
    {
        chapter: 6,
        title: 'Tahtın Gölgesi',
        description: '100 Onura ulaş ve gerçek bir kumandan olduğunu kanıtla.',
        requirementText: '100 Onur',
        ready: user => (Number(user.honor) || 0) >= 100,
        reward: { mount: 'black_stallion', rubies: 3, honor: 10 }
    }
];

const WORLD_EVENT_DEFINITIONS = [
    {
        key: 'caravan_festival',
        icon: '🐫',
        name: 'Kervan Şenliği',
        description: 'Kervanlar şehre ulaştı. Katılanlara Altın dağıtılıyor.',
        reward: { gold: 450 }
    },
    {
        key: 'metin_storm',
        icon: '🪨',
        name: 'Metin Fırtınası',
        description: 'Gökyüzü karardı. Metin avcılarına harita parçası veriliyor.',
        reward: { fragments: 1 }
    },
    {
        key: 'honor_call',
        icon: '🌟',
        name: 'Kumandan Çağrısı',
        description: 'Saray meydanında savaşçılar onurlandırılıyor.',
        reward: { honor: 5 }
    },
    {
        key: 'mine_blessing',
        icon: '⛏️',
        name: 'Maden Bereketi',
        description: 'Demirciler için ekstra Demir Cevheri dağıtılıyor.',
        reward: { iron: 2, gold: 150 }
    }
];

const WORLD_BOSS_NAME = 'Kadim Ejder — Zulkar';
const WORLD_BOSS_MAX_HP = 750000;
const WORLD_BOSS_ATTACK_LIMIT = 5;
const WORLD_BOSS_ATTACK_COOLDOWN_MS = 12 * 1000;
const WORLD_BOSS_START_HOUR = 18;
const WORLD_BOSS_END_HOUR = 24;

const worldBossContributionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    username: { type: String, required: true },
    damage: { type: Number, default: 0 },
    attacks: { type: Number, default: 0 },
    lastAttackAt: { type: Number, default: 0 }
}, { _id: false });

const worldBossStateSchema = new mongoose.Schema({
    key: { type: String, unique: true, default: 'daily_world_boss' },
    dayKey: { type: String, default: '' },
    name: { type: String, default: WORLD_BOSS_NAME },
    maxHp: { type: Number, default: WORLD_BOSS_MAX_HP },
    hp: { type: Number, default: WORLD_BOSS_MAX_HP },
    killed: { type: Boolean, default: false },
    killedAt: { type: Number, default: 0 },
    contributions: { type: [worldBossContributionSchema], default: [] }
});

const WorldBossState = mongoose.model('WorldBossState', worldBossStateSchema);

const worldFeedSchema = new mongoose.Schema({
    type: { type: String, default: 'world' },
    icon: { type: String, default: '📢' },
    message: { type: String, required: true, maxlength: 220 },
    createdAt: { type: Date, default: Date.now, index: true }
});

const WorldFeedEvent = mongoose.model('WorldFeedEvent', worldFeedSchema);

function getTurkeyDateParts(now = Date.now()) {
    const formatter =
        new Intl.DateTimeFormat(
            'en-CA',
            {
                timeZone: 'Europe/Istanbul',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                hourCycle: 'h23'
            }
        );

    const parts =
        Object.fromEntries(
            formatter.formatToParts(
                new Date(now)
            )
            .filter(part => part.type !== 'literal')
            .map(part => [part.type, part.value])
        );

    return {
        year: Number(parts.year),
        month: Number(parts.month),
        day: Number(parts.day),
        hour: Number(parts.hour),
        minute: Number(parts.minute)
    };
}

function getAdventureDayKey(now = Date.now()) {
    return getTurkeyDayKey();
}

function getAdventureWeekKey(now = Date.now()) {
    const p = getTurkeyDateParts(now);

    const base =
        new Date(
            Date.UTC(
                p.year,
                p.month - 1,
                p.day
            )
        );

    const weekday =
        base.getUTCDay() || 7;

    base.setUTCDate(
        base.getUTCDate() -
        (weekday - 1)
    );

    return [
        base.getUTCFullYear(),
        String(base.getUTCMonth() + 1).padStart(2, '0'),
        String(base.getUTCDate()).padStart(2, '0')
    ].join('-');
}

function getAdventureSeasonKey(now = Date.now()) {
    const p = getTurkeyDateParts(now);

    return (
        `${p.year}-` +
        `${String(p.month).padStart(2, '0')}`
    );
}

function getPreviousTurkeyDayKey(now = Date.now()) {
    const p = getTurkeyDateParts(now);

    const utc =
        Date.UTC(
            p.year,
            p.month - 1,
            p.day - 1,
            12,
            0,
            0
        );

    const prev =
        new Date(utc);

    return [
        prev.getUTCFullYear(),
        String(prev.getUTCMonth() + 1).padStart(2, '0'),
        String(prev.getUTCDate()).padStart(2, '0')
    ].join('-');
}

function ensureAdventureState(user) {
    if (!user) return false;

    let changed = false;

    const dayKey =
        getAdventureDayKey();

    const weekKey =
        getAdventureWeekKey();

    const seasonKey =
        getAdventureSeasonKey();

    if (user.adventureDailyKey !== dayKey) {
        user.adventureDailyKey = dayKey;
        user.adventureDailyProgress = {};
        user.adventureDailyClaims = [];
        changed = true;
    }

    if (user.adventureWeeklyKey !== weekKey) {
        user.adventureWeeklyKey = weekKey;
        user.adventureWeeklyProgress = {};
        user.adventureWeeklyClaims = [];
        changed = true;
    }

    if (user.seasonKey !== seasonKey) {
        user.seasonKey = seasonKey;
        user.seasonPoints = 0;
        user.seasonStats = {};
        changed = true;
    }

    if (user.peacefulResetDate !== dayKey) {
        user.peacefulResetDate = dayKey;
        user.fishingAttemptsUsed = 0;
        user.miningAttemptsUsed = 0;
        changed = true;
    }

    if (user.worldBossDayKey !== dayKey) {
        user.worldBossDayKey = dayKey;
        user.worldBossAttackCount = 0;
        user.worldBossLastAttackAt = 0;
        changed = true;
    }

    if (!user.adventureDailyProgress) {
        user.adventureDailyProgress = {};
        changed = true;
    }

    if (!user.adventureWeeklyProgress) {
        user.adventureWeeklyProgress = {};
        changed = true;
    }

    if (!user.seasonStats) {
        user.seasonStats = {};
        changed = true;
    }

    if (!Array.isArray(user.adventureDailyClaims)) {
        user.adventureDailyClaims = [];
        changed = true;
    }

    if (!Array.isArray(user.adventureWeeklyClaims)) {
        user.adventureWeeklyClaims = [];
        changed = true;
    }

    if (!Array.isArray(user.achievementClaims)) {
        user.achievementClaims = [];
        changed = true;
    }

    if (!Array.isArray(user.storyClaims)) {
        user.storyClaims = [];
        changed = true;
    }

    if (!Array.isArray(user.ownedMounts)) {
        user.ownedMounts = [];
        changed = true;
    }

    if (!Array.isArray(user.ownedCompanions)) {
        user.ownedCompanions = [];
        changed = true;
    }

    if (changed) {
        user.markModified('adventureDailyProgress');
        user.markModified('adventureWeeklyProgress');
        user.markModified('seasonStats');
    }

    return changed;
}

function getAdventureCombatBonusPercent(user) {
    let bonus = 0;

    const mount =
        ADVENTURE_MOUNTS[
            String(user?.activeMount || '')
        ];

    const companion =
        ADVENTURE_COMPANIONS[
            String(user?.activeCompanion || '')
        ];

    bonus +=
        Number(
            mount?.combatBonusPercent
        ) || 0;

    bonus +=
        Number(
            companion?.combatBonusPercent
        ) || 0;

    return Math.min(6, Math.max(0, bonus));
}

function addSeasonPoints(
    user,
    amount,
    action = 'other',
    actionAmount = 1
) {
    ensureAdventureState(user);

    const safePoints =
        Math.max(
            0,
            Number.parseInt(amount, 10) || 0
        );

    user.seasonPoints =
        (Number(user.seasonPoints) || 0) +
        safePoints;

    const stats =
        user.seasonStats || {};

    stats[action] =
        (Number(stats[action]) || 0) +
        Math.max(
            0,
            Number(actionAmount) || 0
        );

    user.seasonStats = stats;
    user.markModified('seasonStats');
}

function recordAdventureProgress(
    user,
    action,
    amount = 1,
    seasonPoints = 0
) {
    if (!user) return;

    ensureAdventureState(user);

    const safeAmount =
        Math.max(
            0,
            Number(amount) || 0
        );

    const daily =
        user.adventureDailyProgress || {};

    const weekly =
        user.adventureWeeklyProgress || {};

    for (
        const task
        of ADVENTURE_DAILY_TASKS
    ) {
        if (task.action !== action) continue;

        daily[task.id] =
            (Number(daily[task.id]) || 0) +
            safeAmount;
    }

    for (
        const task
        of ADVENTURE_WEEKLY_TASKS
    ) {
        if (task.action !== action) continue;

        weekly[task.id] =
            (Number(weekly[task.id]) || 0) +
            safeAmount;
    }

    user.adventureDailyProgress = daily;
    user.adventureWeeklyProgress = weekly;

    user.markModified('adventureDailyProgress');
    user.markModified('adventureWeeklyProgress');

    addSeasonPoints(
        user,
        seasonPoints,
        action,
        safeAmount
    );
}

function grantAdventureReward(
    user,
    reward = {}
) {
    ensureAdventureState(user);

    const details = [];

    if ((Number(reward.gold) || 0) > 0) {
        const amount =
            Math.floor(
                Number(reward.gold)
            );

        user.balance =
            (Number(user.balance) || 0) +
            amount;

        details.push(
            `🪙 +${amount.toLocaleString('tr-TR')} Altın`
        );
    }

    if ((Number(reward.rubies) || 0) > 0) {
        const amount =
            Math.floor(
                Number(reward.rubies)
            );

        user.rubies =
            (Number(user.rubies) || 0) +
            amount;

        details.push(
            `💎 +${amount} Yakut`
        );
    }

    if ((Number(reward.honor) || 0) !== 0) {
        const amount =
            Math.floor(
                Number(reward.honor)
            );

        const result =
            applyHonorChange(
                user,
                amount
            );

        details.push(
            `🌟 ${amount >= 0 ? '+' : ''}${amount} Onur`
        );

        if (
            (Number(result.rubyReward) || 0) > 0
        ) {
            details.push(
                `🎁 +${result.rubyReward} Yakut`
            );
        }
    }

    if ((Number(reward.fragments) || 0) > 0) {
        const amount =
            Math.floor(
                Number(reward.fragments)
            );

        user.treasureFragments =
            (Number(user.treasureFragments) || 0) +
            amount;

        details.push(
            `🗺️ +${amount} Hazine Parçası`
        );
    }

    if ((Number(reward.iron) || 0) > 0) {
        normalizeBlacksmithState(user);

        const amount =
            Math.floor(
                Number(reward.iron)
            );

        user.blacksmithMastery.ironOre =
            (Number(user.blacksmithMastery.ironOre) || 0) +
            amount;

        user.markModified('blacksmithMastery');

        details.push(
            `⛏️ +${amount} Demir Cevheri`
        );
    }

    if (reward.mount) {
        const key =
            String(reward.mount);

        if (
            ADVENTURE_MOUNTS[key] &&
            !user.ownedMounts.includes(key)
        ) {
            user.ownedMounts.push(key);

            if (!user.activeMount) {
                user.activeMount = key;
            }

            details.push(
                `${ADVENTURE_MOUNTS[key].icon} ${ADVENTURE_MOUNTS[key].name} açıldı`
            );
        }
    }

    if (reward.companion) {
        const key =
            String(reward.companion);

        if (
            ADVENTURE_COMPANIONS[key] &&
            !user.ownedCompanions.includes(key)
        ) {
            user.ownedCompanions.push(key);

            if (!user.activeCompanion) {
                user.activeCompanion = key;
            }

            details.push(
                `${ADVENTURE_COMPANIONS[key].icon} ${ADVENTURE_COMPANIONS[key].name} açıldı`
            );
        }
    }

    return details;
}

function getTaskStatusList(
    user,
    definitions,
    progress,
    claims
) {
    return definitions.map(task => {
        const current =
            Math.max(
                0,
                Number(progress?.[task.id]) || 0
            );

        const target =
            Math.max(
                1,
                Number(task.target) || 1
            );

        const claimed =
            Array.isArray(claims) &&
            claims.includes(task.id);

        return {
            ...task,
            current:
                Math.min(
                    current,
                    target
                ),
            completed:
                current >= target,
            claimed
        };
    });
}

function getAchievementStatus(user) {
    const claims =
        Array.isArray(user.achievementClaims)
            ? user.achievementClaims
            : [];

    return ADVENTURE_ACHIEVEMENTS.map(
        achievement => ({
            id: achievement.id,
            icon: achievement.icon,
            name: achievement.name,
            description: achievement.description,
            targetText: achievement.targetText,
            unlocked:
                Boolean(
                    achievement.unlocked(user)
                ),
            progress:
                achievement.progress(user),
            claimed:
                claims.includes(
                    achievement.id
                ),
            reward:
                achievement.reward
        })
    );
}

function getCollectionStatus(user) {
    const entries =
        ADVENTURE_COLLECTION.map(
            entry => ({
                id: entry.id,
                icon: entry.icon,
                name: entry.name,
                description: entry.description,
                unlocked:
                    Boolean(
                        entry.unlocked(user)
                    )
            })
        );

    return {
        unlocked:
            entries.filter(
                entry => entry.unlocked
            ).length,
        total:
            entries.length,
        entries
    };
}

function getStoryStatus(user) {
    const currentChapter =
        Math.max(
            1,
            Math.min(
                ADVENTURE_STORY.length + 1,
                Number.parseInt(
                    user.storyChapter,
                    10
                ) || 1
            )
        );

    const chapter =
        ADVENTURE_STORY.find(
            item =>
                item.chapter ===
                currentChapter
        ) || null;

    return {
        currentChapter,
        completed:
            currentChapter >
            ADVENTURE_STORY.length,
        totalChapters:
            ADVENTURE_STORY.length,
        chapter:
            chapter
                ? {
                    chapter:
                        chapter.chapter,
                    title:
                        chapter.title,
                    description:
                        chapter.description,
                    requirementText:
                        chapter.requirementText,
                    ready:
                        Boolean(
                            chapter.ready(user)
                        ),
                    reward:
                        chapter.reward
                }
                : null
    };
}

function getWorldEventWindow(now = Date.now()) {
    const p =
        getTurkeyDateParts(now);

    const slotHour =
        Math.floor(
            p.hour / 2
        ) * 2;

    const turkeyOffset =
        3 * 60 * 60 * 1000;

    const startAt =
        Date.UTC(
            p.year,
            p.month - 1,
            p.day,
            slotHour,
            0,
            0,
            0
        ) -
        turkeyOffset;

    const endAt =
        startAt +
        (30 * 60 * 1000);

    const slotNumber =
        Math.floor(
            startAt /
            (2 * 60 * 60 * 1000)
        );

    const definition =
        WORLD_EVENT_DEFINITIONS[
            Math.abs(slotNumber) %
            WORLD_EVENT_DEFINITIONS.length
        ];

    const eventKey =
        `${getAdventureDayKey()}-${String(slotHour).padStart(2, '0')}-${definition.key}`;

    let nextStartAt;

    if (now < startAt) {
        nextStartAt = startAt;
    } else if (now >= endAt) {
        nextStartAt =
            startAt +
            (2 * 60 * 60 * 1000);
    } else {
        nextStartAt = startAt;
    }

    return {
        eventKey,
        active:
            now >= startAt &&
            now < endAt,
        startAt,
        endAt,
        nextStartAt,
        definition
    };
}

function getWorldBossSchedule(now = Date.now()) {
    const p =
        getTurkeyDateParts(now);

    const turkeyOffset =
        3 * 60 * 60 * 1000;

    const startAt =
        Date.UTC(
            p.year,
            p.month - 1,
            p.day,
            WORLD_BOSS_START_HOUR,
            0,
            0,
            0
        ) -
        turkeyOffset;

    const endAt =
        Date.UTC(
            p.year,
            p.month - 1,
            p.day + 1,
            0,
            0,
            0
        ) -
        turkeyOffset;

    const active =
        now >= startAt &&
        now < endAt;

    let nextStartAt =
        startAt;

    if (now >= endAt) {
        nextStartAt =
            startAt +
            (24 * 60 * 60 * 1000);
    } else if (now >= startAt) {
        nextStartAt = startAt;
    }

    return {
        startAt,
        endAt,
        active,
        nextStartAt
    };
}

async function getOrCreateWorldBoss() {
    const dayKey =
        getAdventureDayKey();

    const boss =
        await WorldBossState.findOneAndUpdate(
            { key: 'daily_world_boss' },
            {
                $setOnInsert: {
                    key: 'daily_world_boss',
                    dayKey,
                    name: WORLD_BOSS_NAME,
                    maxHp: WORLD_BOSS_MAX_HP,
                    hp: WORLD_BOSS_MAX_HP,
                    killed: false,
                    killedAt: 0,
                    contributions: []
                }
            },
            {
                upsert: true,
                new: true,
                setDefaultsOnInsert: true
            }
        );

    if (boss.dayKey !== dayKey) {
        boss.dayKey = dayKey;
        boss.name = WORLD_BOSS_NAME;
        boss.maxHp = WORLD_BOSS_MAX_HP;
        boss.hp = WORLD_BOSS_MAX_HP;
        boss.killed = false;
        boss.killedAt = 0;
        boss.contributions = [];
        await boss.save();
    }

    return boss;
}

async function pushWorldFeed(
    message,
    type = 'world',
    icon = '📢'
) {
    try {
        await WorldFeedEvent.create({
            type,
            icon,
            message:
                String(message || '')
                    .slice(0, 220)
        });

        const oldEvents =
            await WorldFeedEvent.find({})
                .sort({ createdAt: -1 })
                .skip(60)
                .select('_id')
                .lean();

        if (oldEvents.length > 0) {
            await WorldFeedEvent.deleteMany({
                _id: {
                    $in:
                        oldEvents.map(
                            item => item._id
                        )
                }
            });
        }

        io.emit(
            'worldFeedRefresh',
            { message, type, icon }
        );
    } catch (err) {
        console.error(
            'Dünya akışı yazma hatası:',
            err
        );
    }
}

async function getWorldFeedPayload() {
    const feed =
        await WorldFeedEvent.find({})
            .sort({ createdAt: -1 })
            .limit(20)
            .lean();

    return feed.map(item => ({
        id: String(item._id),
        type: item.type,
        icon: item.icon,
        message: item.message,
        createdAt:
            item.createdAt
                ? new Date(item.createdAt).getTime()
                : Date.now()
    }));
}

function syncOnlineAdventureUser(dbUser) {
    if (!dbUser?._id) return;

    for (
        const socketId
        of Object.keys(users)
    ) {
        const online =
            users[socketId];

        if (
            online?._id &&
            String(online._id) ===
            String(dbUser._id)
        ) {
            users[socketId] =
                dbUser;
        }
    }
}

async function processLoginStreak(user) {
    ensureAdventureState(user);

    const today =
        getAdventureDayKey();

    if (user.lastLoginDay === today) {
        return {
            granted: false,
            streak:
                Number(user.loginStreak) || 0,
            message: ''
        };
    }

    const yesterday =
        getPreviousTurkeyDayKey();

    if (user.lastLoginDay === yesterday) {
        const previousStreak =
            Math.max(
                0,
                Number(user.loginStreak) || 0
            );

        // 7 günlük seri tamamlandıktan sonra yeni döngü 1. günden başlar.
        user.loginStreak =
            previousStreak >= 7
                ? 1
                : previousStreak + 1;
    } else {
        user.loginStreak = 1;
    }

    user.lastLoginDay = today;
    user.totalLoginDays =
        (Number(user.totalLoginDays) || 0) +
        1;

    const day =
        Math.max(
            1,
            Math.min(
                7,
                Number(user.loginStreak) || 1
            )
        );

    const rewards = {
        1: { gold: 250 },
        2: { gold: 400 },
        3: { fragments: 1 },
        4: { gold: 750 },
        5: { honor: 5 },
        6: { gold: 1000 },
        7: { rubies: 2, fragments: 1 }
    };

    const rewardDetails =
        grantAdventureReward(
            user,
            rewards[day]
        );

    addSeasonPoints(
        user,
        3,
        'login',
        1
    );

    return {
        granted: true,
        streak: day,
        message:
            `🎁 Günlük giriş serisi ${day}/7: ` +
            rewardDetails.join(' • ')
    };
}

async function getSeasonLeaderboard(user) {
    ensureAdventureState(user);

    const leaders =
        await User.find({
            seasonKey:
                user.seasonKey
        })
        .sort({
            seasonPoints: -1,
            level: -1
        })
        .limit(10)
        .select(
            'username level seasonPoints'
        )
        .lean();

    return leaders.map(
        (entry, index) => ({
            rank: index + 1,
            username:
                entry.username,
            level:
                Number(entry.level) || 1,
            points:
                Number(
                    entry.seasonPoints
                ) || 0,
            isMe:
                String(entry._id) ===
                String(user._id)
        })
    );
}

async function getWorldBossPayload(user) {
    ensureAdventureState(user);

    const boss =
        await getOrCreateWorldBoss();

    const schedule =
        getWorldBossSchedule();

    const leaderboard =
        [...(boss.contributions || [])]
        .sort(
            (a, b) =>
                (Number(b.damage) || 0) -
                (Number(a.damage) || 0)
        )
        .slice(0, 10)
        .map(
            (entry, index) => ({
                rank: index + 1,
                userId:
                    String(entry.userId),
                username:
                    entry.username,
                damage:
                    Number(entry.damage) || 0,
                attacks:
                    Number(entry.attacks) || 0,
                isMe:
                    String(entry.userId) ===
                    String(user._id)
            })
        );

    const myEntry =
        (boss.contributions || [])
        .find(
            entry =>
                String(entry.userId) ===
                String(user._id)
        );

    const used =
        Math.max(
            Number(user.worldBossAttackCount) || 0,
            Number(myEntry?.attacks) || 0
        );

    const cooldown =
        Math.max(
            0,
            WORLD_BOSS_ATTACK_COOLDOWN_MS -
            (
                Date.now() -
                Math.max(
                    Number(user.worldBossLastAttackAt) || 0,
                    Number(myEntry?.lastAttackAt) || 0
                )
            )
        );

    return {
        name: boss.name,
        dayKey: boss.dayKey,
        maxHp: Number(boss.maxHp) || WORLD_BOSS_MAX_HP,
        hp: Math.max(0, Number(boss.hp) || 0),
        killed: Boolean(boss.killed),
        killedAt: Number(boss.killedAt) || 0,
        active:
            Boolean(
                schedule.active &&
                !boss.killed
            ),
        schedule,
        attackLimit:
            WORLD_BOSS_ATTACK_LIMIT,
        attacksUsed: used,
        attacksRemaining:
            Math.max(
                0,
                WORLD_BOSS_ATTACK_LIMIT -
                used
            ),
        cooldownRemainingMs:
            cooldown,
        myDamage:
            Number(myEntry?.damage) || 0,
        leaderboard,
        characterPower:
            getCharacterCombatPower(user),
        armyPower:
            getArmyPower(user.army)
    };
}

async function getAdventureHubPayload(user) {
    ensureAdventureState(user);

    const event =
        getWorldEventWindow();

    const leaderboard =
        await getSeasonLeaderboard(user);

    const feed =
        await getWorldFeedPayload();

    const loginDay =
        Math.max(
            0,
            Math.min(
                7,
                Number(user.loginStreak) || 0
            )
        );

    return {
        userData: user,
        dailyKey:
            user.adventureDailyKey,
        weeklyKey:
            user.adventureWeeklyKey,
        dailyTasks:
            getTaskStatusList(
                user,
                ADVENTURE_DAILY_TASKS,
                user.adventureDailyProgress,
                user.adventureDailyClaims
            ),
        weeklyTasks:
            getTaskStatusList(
                user,
                ADVENTURE_WEEKLY_TASKS,
                user.adventureWeeklyProgress,
                user.adventureWeeklyClaims
            ),
        achievements:
            getAchievementStatus(user),
        collection:
            getCollectionStatus(user),
        treasure: {
            fragments:
                Number(
                    user.treasureFragments
                ) || 0,
            needed: 5,
            chestsOpened:
                Number(
                    user.treasureChestsOpened
                ) || 0
        },
        mounts: {
            active:
                user.activeMount || '',
            owned:
                Object.values(
                    ADVENTURE_MOUNTS
                ).map(item => ({
                    ...item,
                    owned:
                        user.ownedMounts.includes(
                            item.key
                        ),
                    active:
                        user.activeMount ===
                        item.key
                }))
        },
        companions: {
            active:
                user.activeCompanion || '',
            owned:
                Object.values(
                    ADVENTURE_COMPANIONS
                ).map(item => ({
                    ...item,
                    owned:
                        user.ownedCompanions.includes(
                            item.key
                        ),
                    active:
                        user.activeCompanion ===
                        item.key
                }))
        },
        peaceful: {
            fishingUsed:
                Number(
                    user.fishingAttemptsUsed
                ) || 0,
            miningUsed:
                Number(
                    user.miningAttemptsUsed
                ) || 0,
            dailyLimit: 5,
            fishCaught:
                Number(
                    user.fishCaught
                ) || 0,
            oreMined:
                Number(
                    user.oreMined
                ) || 0
        },
        story:
            getStoryStatus(user),
        login: {
            streak: loginDay,
            totalDays:
                Number(
                    user.totalLoginDays
                ) || 0,
            todayClaimed:
                user.lastLoginDay ===
                getAdventureDayKey()
        },
        season: {
            key:
                user.seasonKey,
            points:
                Number(
                    user.seasonPoints
                ) || 0,
            leaderboard
        },
        worldEvent: {
            active:
                event.active,
            eventKey:
                event.eventKey,
            startAt:
                event.startAt,
            endAt:
                event.endAt,
            nextStartAt:
                event.nextStartAt,
            icon:
                event.definition.icon,
            name:
                event.definition.name,
            description:
                event.definition.description,
            reward:
                event.definition.reward,
            claimed:
                user.worldEventClaimKey ===
                event.eventKey
        },
        feed,
        combatBonusPercent:
            getAdventureCombatBonusPercent(
                user
            )
    };
}

async function rewardWorldBossKill(
    boss,
    killerUserId = null
) {
    if (!boss?.killed) return;

    const sorted =
        [...(boss.contributions || [])]
        .filter(
            entry =>
                (Number(entry.attacks) || 0) > 0
        )
        .sort(
            (a, b) =>
                (Number(b.damage) || 0) -
                (Number(a.damage) || 0)
        );

    for (
        let index = 0;
        index < sorted.length;
        index++
    ) {
        const entry =
            sorted[index];

        const rewardUser =
            await User.findById(
                entry.userId
            );

        if (!rewardUser) continue;

        ensureAdventureState(
            rewardUser
        );

        let gold =
            Math.max(
                250,
                Math.floor(
                    500 +
                    (Number(entry.damage) || 0) /
                    250
                )
            );

        let honor = 5;

        if (index === 0) {
            gold += 3000;
            honor += 15;
        } else if (index < 3) {
            gold += 1500;
            honor += 8;
        } else if (index < 10) {
            gold += 600;
            honor += 3;
        }

        const details =
            grantAdventureReward(
                rewardUser,
                {
                    gold,
                    honor,
                    fragments:
                        index < 3
                            ? 2
                            : 1
                }
            );

        addSeasonPoints(
            rewardUser,
            index === 0
                ? 40
                : (
                    index < 3
                        ? 25
                        : 15
                ),
            'world_boss_kill',
            1
        );

        await rewardUser.save();

        syncOnlineAdventureUser(
            rewardUser
        );

        emitToOnlineUser(
            rewardUser._id,
            'worldBossReward',
            {
                success: true,
                userData:
                    rewardUser,
                message:
                    `👹 ${WORLD_BOSS_NAME} yenildi! ` +
                    `Sıralaman #${index + 1}. ` +
                    details.join(' • ')
            }
        );
    }

    const winner =
        sorted[0];

    if (winner) {
        await pushWorldFeed(
            `👹 ${WORLD_BOSS_NAME} yenildi! Günün en yüksek hasarını ${winner.username} verdi (${Number(winner.damage || 0).toLocaleString('tr-TR')}).`,
            'boss',
            '👹'
        );
    }
}

// ============================================================================
// MACERA PAKETİ V1 SONU
// ============================================================================

io.on('connection', (socket) => {
    socket.on('getGameBuildInfo', () => {
        socket.emit('gameBuildInfo', {
            build: GAME_BUILD_ID,
            clanV1: true,
            clanCastleWarV1: true,
            honorRubyRewards: true,
            catapult: true,
            onlineCounter: true,
            adventurePackV1: true,
            worldBossV1: true,
            seasonV1: true
        });
    });

    // Giriş yapmamış istemci dahil herkese mevcut online oyuncu sayısını göster.
    socket.emit('onlinePlayerCount', {
        count: getOnlinePlayerCount()
    });

    socket.on('userRegister', async (data) => {
        const { username, password } = data;
        if (!username || !password) return socket.emit('authResult', { success: false, message: "Eksik bilgi!" });
        try {
            const existing = await User.findOne({ username });
            if (existing) return socket.emit('authResult', { success: false, message: "Bu isimde gladyatör var!" });
            
            const hashedPassword = await bcrypt.hash(password, 10);
            const token = crypto.randomBytes(16).toString('hex');
            
            const newUser = new User({ 
                username, 
                password: hashedPassword, 
                token: token,
                lastCollected: Date.now(),
                inventory: getDefaultInventory(), 
                arenaResetDate: new Date().toDateString() 
            });
            await newUser.save();
            socket.emit('authResult', { success: true, message: "Kayıt başarılı!", token: token });
        } catch (err) { socket.emit('authResult', { success: false, message: "Hata oluştu." }); }
    });

    socket.on('userLogin', async (data) => {
        const { username, password } = data;
        try {
            const dbUser = await User.findOne({ username });
            if (!dbUser || !(await bcrypt.compare(password, dbUser.password))) {
                return socket.emit('authResult', { success: false, message: "Hatalı kullanıcı adı veya şifre!" });
            }
            
            const token = crypto.randomBytes(16).toString('hex');
            dbUser.token = token;
            
            const offlineGold = await calculateOfflineGold(dbUser);
            checkSeferRefill(dbUser);
            checkArenaReset(dbUser);
            checkDungeonDailyReset(dbUser);
            normalizePlayerLevel(dbUser);
            normalizeMetinState(dbUser);
            normalizeArmy(dbUser);
            normalizeSiegeMarketState(dbUser);
            normalizeBankState(dbUser);
            normalizeBlacksmithState(dbUser);
            normalizeTimarState(dbUser);
            ensureAdventureState(dbUser);

            const loginReward =
                await processLoginStreak(
                    dbUser
                );

            await dbUser.save();
            
            users[socket.id] = dbUser;
            broadcastOnlinePlayerCount();
            socket.emit('authResult', { success: true, message: "Giriş başarılı!", token: token });
            
            const userData = dbUser.toObject();
            userData.offlineGoldEarned = offlineGold;
            userData.loginRewardMessage =
                loginReward?.granted
                    ? loginReward.message
                    : '';
            socket.emit('userData', userData);
        } catch (err) { socket.emit('authResult', { success: false, message: "Giriş hatası." }); }
    });

    socket.on('tokenLogin', async (data) => {
        const { token } = data;
        if (!token) return;
        try {
            const dbUser = await User.findOne({ token });
            if (!dbUser) {
                return socket.emit('authResult', { success: false, message: "Oturum süresi doldu.", clearToken: true });
            }
            
            const offlineGold = await calculateOfflineGold(dbUser);
            checkSeferRefill(dbUser);
            checkArenaReset(dbUser);
            checkDungeonDailyReset(dbUser);
            normalizePlayerLevel(dbUser);
            normalizeMetinState(dbUser);
            normalizeArmy(dbUser);
            normalizeSiegeMarketState(dbUser);
            normalizeBankState(dbUser);
            normalizeBlacksmithState(dbUser);
            normalizeTimarState(dbUser);
            ensureAdventureState(dbUser);

            const loginReward =
                await processLoginStreak(
                    dbUser
                );

            await dbUser.save();
            
            users[socket.id] = dbUser;
            broadcastOnlinePlayerCount();
            const userData = dbUser.toObject();
            userData.offlineGoldEarned = offlineGold;
            userData.loginRewardMessage =
                loginReward?.granted
                    ? loginReward.message
                    : '';
            socket.emit('userData', userData);
        } catch (err) { 
            console.error(err);
        }
    });

    // ========================================================
    // MACERA MERKEZİ
    // ========================================================
    socket.on('getAdventureHubStatus', async () => {
        const user = users[socket.id];
        if (!user) return;

        try {
            // Salt-okuma isteği: aynı kullanıcı dokümanı üzerinde eşzamanlı
            // save() çağrısı ParallelSaveError oluşturabiliyordu.
            // Gün/hafta/sezon resetleri in-memory uygulanır; gerçek bir write
            // işlemi geldiğinde normal user.save() ile kalıcılaşır.
            ensureAdventureState(user);

            socket.emit(
                'adventureHubStatus',
                await getAdventureHubPayload(user)
            );
        } catch (err) {
            console.error(
                'Macera Merkezi yükleme hatası:',
                err
            );

            socket.emit(
                'adventureHubResult',
                {
                    success: false,
                    userData: user,
                    message:
                        'Macera Merkezi bilgileri yüklenemedi.'
                }
            );
        }
    });

    socket.on('claimAdventureTask', async (data) => {
        if (!checkRateLimit(socket.id)) return;

        const user = users[socket.id];
        if (!user) return;

        try {
            ensureAdventureState(user);

            const scope =
                data?.scope === 'weekly'
                    ? 'weekly'
                    : 'daily';

            const id =
                String(data?.taskId || '');

            const definitions =
                scope === 'weekly'
                    ? ADVENTURE_WEEKLY_TASKS
                    : ADVENTURE_DAILY_TASKS;

            const task =
                definitions.find(
                    item =>
                        item.id === id
                );

            if (!task) {
                return socket.emit(
                    'adventureHubResult',
                    {
                        success: false,
                        userData: user,
                        message:
                            'Görev ödülü bulunamadı.'
                    }
                );
            }

            const progress =
                scope === 'weekly'
                    ? user.adventureWeeklyProgress
                    : user.adventureDailyProgress;

            const claims =
                scope === 'weekly'
                    ? user.adventureWeeklyClaims
                    : user.adventureDailyClaims;

            if (
                (Number(progress?.[task.id]) || 0) <
                task.target
            ) {
                return socket.emit(
                    'adventureHubResult',
                    {
                        success: false,
                        userData: user,
                        message:
                            'Bu görev henüz tamamlanmadı.'
                    }
                );
            }

            if (
                Array.isArray(claims) &&
                claims.includes(task.id)
            ) {
                return socket.emit(
                    'adventureHubResult',
                    {
                        success: false,
                        userData: user,
                        message:
                            'Bu ödülü zaten aldın.'
                    }
                );
            }

            claims.push(task.id);

            const details =
                grantAdventureReward(
                    user,
                    task.reward
                );

            addSeasonPoints(
                user,
                scope === 'weekly'
                    ? 12
                    : 4,
                `${scope}_claim`,
                1
            );

            await user.save();

            socket.emit(
                'adventureHubResult',
                {
                    success: true,
                    userData: user,
                    message:
                        `🎁 ${task.name}: ` +
                        details.join(' • ')
                }
            );

            socket.emit(
                'adventureHubStatus',
                await getAdventureHubPayload(user)
            );
        } catch (err) {
            console.error(
                'Macera görev ödülü hatası:',
                err
            );
        }
    });

    socket.on('claimAchievementReward', async (data) => {
        if (!checkRateLimit(socket.id)) return;

        const user = users[socket.id];
        if (!user) return;

        try {
            ensureAdventureState(user);

            const id =
                String(
                    data?.achievementId || ''
                );

            const achievement =
                ADVENTURE_ACHIEVEMENTS.find(
                    item =>
                        item.id === id
                );

            if (
                !achievement ||
                !achievement.unlocked(user)
            ) {
                return socket.emit(
                    'adventureHubResult',
                    {
                        success: false,
                        userData: user,
                        message:
                            'Başarım henüz tamamlanmadı.'
                    }
                );
            }

            if (
                user.achievementClaims.includes(
                    id
                )
            ) {
                return socket.emit(
                    'adventureHubResult',
                    {
                        success: false,
                        userData: user,
                        message:
                            'Bu başarım ödülü zaten alındı.'
                    }
                );
            }

            user.achievementClaims.push(id);

            const details =
                grantAdventureReward(
                    user,
                    achievement.reward
                );

            addSeasonPoints(
                user,
                10,
                'achievement',
                1
            );

            await user.save();

            await pushWorldFeed(
                `${user.username}, "${achievement.name}" başarımını tamamladı.`,
                'achievement',
                '🏆'
            );

            socket.emit(
                'adventureHubResult',
                {
                    success: true,
                    userData: user,
                    message:
                        `🏆 ${achievement.name}: ` +
                        details.join(' • ')
                }
            );

            socket.emit(
                'adventureHubStatus',
                await getAdventureHubPayload(user)
            );
        } catch (err) {
            console.error(
                'Başarım ödülü hatası:',
                err
            );
        }
    });

    socket.on('openTreasureChest', async () => {
        if (!checkRateLimit(socket.id)) return;

        const user = users[socket.id];
        if (!user) return;

        try {
            ensureAdventureState(user);

            if (
                (Number(user.treasureFragments) || 0) <
                5
            ) {
                return socket.emit(
                    'adventureHubResult',
                    {
                        success: false,
                        userData: user,
                        message:
                            '🗺️ Hazine Sandığı için 5 harita parçası gerekiyor.'
                    }
                );
            }

            user.treasureFragments -= 5;
            user.treasureChestsOpened =
                (Number(user.treasureChestsOpened) || 0) +
                1;

            const gold =
                600 +
                Math.floor(
                    Math.random() * 2401
                );

            const reward = {
                gold
            };

            if (Math.random() < 0.28) {
                reward.rubies =
                    1 +
                    Math.floor(
                        Math.random() * 3
                    );
            }

            const rareRoll =
                Math.random();

            if (rareRoll < 0.06) {
                reward.companion =
                    'wolf';
            } else if (rareRoll < 0.10) {
                reward.mount =
                    'war_horse';
            }

            const details =
                grantAdventureReward(
                    user,
                    reward
                );

            addSeasonPoints(
                user,
                8,
                'treasure',
                1
            );

            await user.save();

            if (
                reward.companion ||
                reward.mount ||
                (Number(reward.rubies) || 0) >= 3
            ) {
                await pushWorldFeed(
                    `${user.username} bir Hazine Sandığından nadir ödül buldu!`,
                    'treasure',
                    '🗺️'
                );
            }

            socket.emit(
                'adventureHubResult',
                {
                    success: true,
                    userData: user,
                    special:
                        Boolean(
                            reward.companion ||
                            reward.mount
                        ),
                    message:
                        `🗺️ Hazine Sandığı açıldı! ` +
                        details.join(' • ')
                }
            );

            socket.emit(
                'adventureHubStatus',
                await getAdventureHubPayload(user)
            );
        } catch (err) {
            console.error(
                'Hazine sandığı hatası:',
                err
            );
        }
    });

    socket.on('selectAdventureMount', async (data) => {
        if (!checkRateLimit(socket.id)) return;

        const user = users[socket.id];
        if (!user) return;

        const key =
            String(data?.key || '');

        if (
            !ADVENTURE_MOUNTS[key] ||
            !user.ownedMounts.includes(key)
        ) {
            return;
        }

        user.activeMount = key;
        await user.save();

        socket.emit(
            'adventureHubResult',
            {
                success: true,
                userData: user,
                message:
                    `${ADVENTURE_MOUNTS[key].icon} ${ADVENTURE_MOUNTS[key].name} aktif binek oldu.`
            }
        );

        socket.emit(
            'adventureHubStatus',
            await getAdventureHubPayload(user)
        );
    });

    socket.on('selectAdventureCompanion', async (data) => {
        if (!checkRateLimit(socket.id)) return;

        const user = users[socket.id];
        if (!user) return;

        const key =
            String(data?.key || '');

        if (
            !ADVENTURE_COMPANIONS[key] ||
            !user.ownedCompanions.includes(key)
        ) {
            return;
        }

        user.activeCompanion = key;
        await user.save();

        socket.emit(
            'adventureHubResult',
            {
                success: true,
                userData: user,
                message:
                    `${ADVENTURE_COMPANIONS[key].icon} ${ADVENTURE_COMPANIONS[key].name} aktif yoldaş oldu.`
            }
        );

        socket.emit(
            'adventureHubStatus',
            await getAdventureHubPayload(user)
        );
    });

    socket.on('doPeacefulActivity', async (data) => {
        if (!checkRateLimit(socket.id)) return;

        const user = users[socket.id];
        if (!user) return;

        try {
            ensureAdventureState(user);

            const type =
                String(data?.type || '');

            if (
                !['fishing', 'mining'].includes(
                    type
                )
            ) {
                return;
            }

            const usedKey =
                type === 'fishing'
                    ? 'fishingAttemptsUsed'
                    : 'miningAttemptsUsed';

            const used =
                Number(user[usedKey]) || 0;

            if (used >= 5) {
                return socket.emit(
                    'adventureHubResult',
                    {
                        success: false,
                        userData: user,
                        message:
                            `⏳ ${type === 'fishing' ? 'Balık tutma' : 'Maden kazma'} günlük 5/5 hakkın doldu.`
                    }
                );
            }

            user[usedKey] = used + 1;

            let message = '';

            if (type === 'fishing') {
                const gold =
                    70 +
                    Math.floor(
                        Math.random() * 181
                    );

                user.balance += gold;
                user.fishCaught =
                    (Number(user.fishCaught) || 0) +
                    1;

                let fragmentText = '';

                if (Math.random() < 0.15) {
                    user.treasureFragments =
                        (Number(user.treasureFragments) || 0) +
                        1;

                    fragmentText =
                        ' 🗺️ +1 Hazine Parçası!';
                }

                recordAdventureProgress(
                    user,
                    'fishing',
                    1,
                    1
                );

                message =
                    `🎣 Balık tuttun! 🪙 +${gold} Altın.` +
                    fragmentText;
            } else {
                normalizeBlacksmithState(user);

                const iron =
                    1 +
                    Math.floor(
                        Math.random() * 3
                    );

                const gold =
                    40 +
                    Math.floor(
                        Math.random() * 91
                    );

                user.blacksmithMastery.ironOre =
                    (Number(user.blacksmithMastery.ironOre) || 0) +
                    iron;

                user.balance += gold;
                user.oreMined =
                    (Number(user.oreMined) || 0) +
                    iron;

                user.markModified(
                    'blacksmithMastery'
                );

                recordAdventureProgress(
                    user,
                    'mining',
                    1,
                    1
                );

                message =
                    `⛏️ Maden kazdın! +${iron} Demir Cevheri • 🪙 +${gold} Altın.`;
            }

            await user.save();

            socket.emit(
                'adventureHubResult',
                {
                    success: true,
                    userData: user,
                    message
                }
            );

            socket.emit(
                'adventureHubStatus',
                await getAdventureHubPayload(user)
            );
        } catch (err) {
            console.error(
                'Sakin aktivite hatası:',
                err
            );
        }
    });

    socket.on('claimStoryChapter', async () => {
        if (!checkRateLimit(socket.id)) return;

        const user = users[socket.id];
        if (!user) return;

        try {
            ensureAdventureState(user);

            const story =
                getStoryStatus(user);

            if (
                story.completed ||
                !story.chapter
            ) {
                return socket.emit(
                    'adventureHubResult',
                    {
                        success: false,
                        userData: user,
                        message:
                            'Hikâye zincirinin mevcut bölümleri tamamlandı.'
                    }
                );
            }

            const chapterDef =
                ADVENTURE_STORY.find(
                    item =>
                        item.chapter ===
                        story.chapter.chapter
                );

            if (
                !chapterDef ||
                !chapterDef.ready(user)
            ) {
                return socket.emit(
                    'adventureHubResult',
                    {
                        success: false,
                        userData: user,
                        message:
                            `📜 Önce şartı tamamla: ${story.chapter.requirementText}`
                    }
                );
            }

            if (
                user.storyClaims.includes(
                    chapterDef.chapter
                )
            ) {
                return;
            }

            user.storyClaims.push(
                chapterDef.chapter
            );

            user.storyChapter =
                chapterDef.chapter + 1;

            const details =
                grantAdventureReward(
                    user,
                    chapterDef.reward
                );

            addSeasonPoints(
                user,
                20,
                'story',
                1
            );

            await user.save();

            await pushWorldFeed(
                `${user.username}, hikâyenin "${chapterDef.title}" bölümünü tamamladı.`,
                'story',
                '📜'
            );

            socket.emit(
                'adventureHubResult',
                {
                    success: true,
                    userData: user,
                    message:
                        `📜 ${chapterDef.title} tamamlandı! ` +
                        details.join(' • ')
                }
            );

            socket.emit(
                'adventureHubStatus',
                await getAdventureHubPayload(user)
            );
        } catch (err) {
            console.error(
                'Hikâye bölümü hatası:',
                err
            );
        }
    });

    socket.on('claimWorldEvent', async () => {
        if (!checkRateLimit(socket.id)) return;

        const user = users[socket.id];
        if (!user) return;

        try {
            ensureAdventureState(user);

            const event =
                getWorldEventWindow();

            if (!event.active) {
                return socket.emit(
                    'adventureHubResult',
                    {
                        success: false,
                        userData: user,
                        message:
                            '🌍 Dünya Olayı şu anda aktif değil.'
                    }
                );
            }

            if (
                user.worldEventClaimKey ===
                event.eventKey
            ) {
                return socket.emit(
                    'adventureHubResult',
                    {
                        success: false,
                        userData: user,
                        message:
                            'Bu Dünya Olayına zaten katıldın.'
                    }
                );
            }

            user.worldEventClaimKey =
                event.eventKey;

            const details =
                grantAdventureReward(
                    user,
                    event.definition.reward
                );

            addSeasonPoints(
                user,
                5,
                'world_event',
                1
            );

            await user.save();

            socket.emit(
                'adventureHubResult',
                {
                    success: true,
                    userData: user,
                    message:
                        `${event.definition.icon} ${event.definition.name}: ` +
                        details.join(' • ')
                }
            );

            socket.emit(
                'adventureHubStatus',
                await getAdventureHubPayload(user)
            );
        } catch (err) {
            console.error(
                'Dünya Olayı katılım hatası:',
                err
            );
        }
    });

    // ========================================================
    // DÜNYA BOSSU
    // ========================================================
    socket.on('getWorldBossStatus', async () => {
        const user = users[socket.id];
        if (!user) return;

        try {
            // Salt-okuma isteği. Status yenilemesi sırasında user.save()
            // çağırmak aynı document'in paralel kaydına neden oluyordu.
            ensureAdventureState(user);

            socket.emit(
                'worldBossStatus',
                await getWorldBossPayload(user)
            );
        } catch (err) {
            console.error(
                'Dünya Bossu yükleme hatası:',
                err
            );
        }
    });

    socket.on('attackWorldBoss', async () => {
        if (!checkRateLimit(socket.id)) return;

        const user = users[socket.id];
        if (!user) return;

        try {
            ensureAdventureState(user);

            const schedule =
                getWorldBossSchedule();

            if (!schedule.active) {
                return socket.emit(
                    'worldBossResult',
                    {
                        success: false,
                        userData: user,
                        status:
                            await getWorldBossPayload(user),
                        message:
                            '👹 Dünya Bossu her gün Türkiye saatiyle 18:00–23:59 arasında saldırıya açıktır.'
                    }
                );
            }

            const boss =
                await getOrCreateWorldBoss();

            if (boss.killed) {
                return socket.emit(
                    'worldBossResult',
                    {
                        success: false,
                        userData: user,
                        status:
                            await getWorldBossPayload(user),
                        message:
                            '🏆 Dünya Bossu bugün zaten yenildi.'
                    }
                );
            }

            if (
                (Number(user.worldBossAttackCount) || 0) >=
                WORLD_BOSS_ATTACK_LIMIT
            ) {
                return socket.emit(
                    'worldBossResult',
                    {
                        success: false,
                        userData: user,
                        status:
                            await getWorldBossPayload(user),
                        message:
                            '⛔ Bugünkü 5 Dünya Bossu saldırı hakkını kullandın.'
                    }
                );
            }

            const cooldown =
                Math.max(
                    0,
                    WORLD_BOSS_ATTACK_COOLDOWN_MS -
                    (
                        Date.now() -
                        (Number(user.worldBossLastAttackAt) || 0)
                    )
                );

            if (cooldown > 0) {
                return socket.emit(
                    'worldBossResult',
                    {
                        success: false,
                        userData: user,
                        status:
                            await getWorldBossPayload(user),
                        message:
                            `⏳ Yeni saldırı için ${Math.ceil(cooldown / 1000)} saniye bekle.`
                    }
                );
            }

            normalizeArmy(user);

            const characterPower =
                getCharacterCombatPower(user);

            const armyPower =
                getArmyPower(user.army);

            const damage =
                Math.max(
                    1,
                    Math.floor(
                        (characterPower + armyPower) *
                        (0.90 + Math.random() * 0.20)
                    )
                );

            const actualDamage =
                Math.min(
                    damage,
                    Math.max(
                        0,
                        Number(boss.hp) || 0
                    )
                );

            boss.hp =
                Math.max(
                    0,
                    (Number(boss.hp) || 0) -
                    actualDamage
                );

            let entry =
                (boss.contributions || [])
                .find(
                    item =>
                        String(item.userId) ===
                        String(user._id)
                );

            if (!entry) {
                boss.contributions.push({
                    userId: user._id,
                    username: user.username,
                    damage: 0,
                    attacks: 0,
                    lastAttackAt: 0
                });

                entry =
                    boss.contributions[
                        boss.contributions.length - 1
                    ];
            }

            entry.damage =
                (Number(entry.damage) || 0) +
                actualDamage;

            entry.attacks =
                (Number(entry.attacks) || 0) +
                1;

            entry.lastAttackAt =
                Date.now();

            user.worldBossAttackCount =
                (Number(user.worldBossAttackCount) || 0) +
                1;

            user.worldBossLastAttackAt =
                Date.now();

            recordAdventureProgress(
                user,
                'world_boss_attack',
                1,
                10
            );

            let killedNow = false;

            if (boss.hp <= 0) {
                boss.killed = true;
                boss.killedAt =
                    Date.now();

                killedNow = true;
            }

            boss.markModified(
                'contributions'
            );

            await Promise.all([
                boss.save(),
                user.save()
            ]);

            const status =
                await getWorldBossPayload(user);

            socket.emit(
                'worldBossResult',
                {
                    success: true,
                    killed: killedNow,
                    damage: actualDamage,
                    userData: user,
                    status,
                    message:
                        `👹 ${WORLD_BOSS_NAME}'a ${actualDamage.toLocaleString('tr-TR')} hasar verdin! ` +
                        `Boss HP: ${status.hp.toLocaleString('tr-TR')}/${status.maxHp.toLocaleString('tr-TR')} • ` +
                        `Kalan saldırı: ${status.attacksRemaining}/${WORLD_BOSS_ATTACK_LIMIT}`
                }
            );

            io.emit(
                'worldBossRefresh',
                {
                    dayKey: boss.dayKey,
                    killed: boss.killed
                }
            );

            if (killedNow) {
                await rewardWorldBossKill(
                    boss,
                    user._id
                );
            }
        } catch (err) {
            console.error(
                'Dünya Bossu saldırı hatası:',
                err
            );

            socket.emit(
                'worldBossResult',
                {
                    success: false,
                    userData: user,
                    message:
                        'Dünya Bossuna saldırı sırasında hata oluştu.'
                }
            );
        }
    });

    socket.on('logout', () => {
        delete users[socket.id];
        broadcastOnlinePlayerCount();
        socket.emit('logoutSuccess');
    });

    socket.on('getOverviewStatus', async () => {
        // Salt-okuma isteği. Stat dağıtımından hemen sonra da çalışabilmesi için
        // global işlem rate-limitine tabi tutulmuyor.
        const user = users[socket.id];
        if (!user) return;

        try {
            normalizeArmy(user);

            const castle = await getOrCreateCastle();
            const isThroneOwner = Boolean(
                castle?.ownerId && String(castle.ownerId) === String(user._id)
            );

            const equipment = getEquipmentStatTotals(user);
            const setBonuses = getHukumdarSetBonusState(user);
            const totalStr = getTotalStr(user);
            const totalVit = getTotalVit(user);
            const combatPower = getCharacterCombatPower(user);
            const armyPower = getArmyPower(user.army) + totalStr;

            const achievements = [
                {
                    id: 'first_conquest', icon: '🏰', name: 'İlk Fetih',
                    description: 'En az bir kez kaleyi fethet.',
                    unlocked: (user.castleVictories || 0) >= 1,
                    progress: `${user.castleVictories || 0}/1`
                },
                {
                    id: 'arena_master', icon: '⚔️', name: 'Arena Ustası',
                    description: '10 PvP Arena zaferi kazan.',
                    unlocked: (user.arenaWins || 0) >= 10,
                    progress: `${Math.min(10, user.arenaWins || 0)}/10`
                },
                {
                    id: 'dungeon_conqueror', icon: '🐉', name: 'Zindan Fatihi',
                    description: '10. kat final bossunu yen.',
                    unlocked: (user.dungeonBossWins || 0) >= 1,
                    progress: `${user.dungeonBossWins || 0}/1`
                },
                {
                    id: 'metin_hunter', icon: '🪨', name: 'Metin Avcısı',
                    description: '10 Metin Taşı parçala.',
                    unlocked: (user.metinKills || 0) >= 10,
                    progress: `${Math.min(10, user.metinKills || 0)}/10`
                },
                {
                    id: 'throne_holder', icon: '👑', name: 'Taht Sahibi',
                    description: 'Taht Kalesi’nin mevcut sahibi ol.',
                    unlocked: isThroneOwner,
                    progress: isThroneOwner ? 'AKTİF' : 'Kilitli'
                },
                {
                    id: 'hukumdar_set', icon: '✨', name: 'Hükümdarın Kudreti',
                    description: '8 Hükümdar Seti parçasını aynı anda kuşan.',
                    unlocked: setBonuses.pieceCount >= 8,
                    progress: `${setBonuses.pieceCount}/8`
                }
            ];

            socket.emit('overviewStatus', {
                userData: user,
                isThroneOwner,
                throneOwnerName: castle?.ownerName || 'Saray Muhafızları',
                combat: {
                    baseStr: Number(user.str) || 5,
                    baseVit: Number(user.vit) || 5,
                    equipmentStr: equipment.str,
                    equipmentVit: equipment.vit,
                    totalStr,
                    totalVit,
                    combatPower,
                    armyPower,
                    maxHp: calculateMaxHpForProgression(user)
                },
                set: {
                    ...setBonuses,
                    ownedSlots: getOwnedHukumdarSetSlots(user),
                    definitions: HUKUMDAR_SET_ITEMS
                },
                prestige: {
                    honor: user.honor || 0,
                    arenaWins: user.arenaWins || 0,
                    castleVictories: user.castleVictories || 0,
                    dungeonBossWins: user.dungeonBossWins || 0,
                    metinKills: user.metinKills || 0,
                    dungeonFloor: user.dungeonFloor || 1
                },
                achievements
            });
        } catch (err) {
            console.error('Genel durum yükleme hatası:', err);
            socket.emit('overviewStatus', { userData: user, error: true });
        }
    });

    socket.on('distributeStat', async (statName) => {
        if (!checkRateLimit(socket.id)) return;
        const user = users[socket.id];
        if (user && user.statPoints > 0) {
            if (statName === 'str') {
                user.str += 1;
            }

            if (statName === 'vit') {
                const oldMaxHp = calculateMaxHpForProgression(user);
                user.vit += 1;
                const newMaxHp = calculateMaxHpForProgression(user);
                user.hp = Math.min(newMaxHp, (Number(user.hp) || 0) + (newMaxHp - oldMaxHp));
            }

            user.statPoints -= 1;
            await user.save();
            socket.emit('statUpdated', user);
        }
    });

    socket.on('doQuest', async (data) => {
        if (!checkRateLimit(socket.id)) return;

        const user = users[socket.id];
        if (!user) return;

        checkSeferRefill(user);

        if (user.seferLimiti <= 0) {
            return socket.emit('questResult', {
                success: false,
                userData: user,
                message: "⏳ Sefer hakkın bitti! Sefer limitinin yenilenmesini beklemelisin."
            });
        }

        const quests = {
            1: {
                name: 'Köy Devriyesi',
                requiredLevel: 1,
                gold: 45,
                exp: 20,
                hpCost: 10
            },
            2: {
                name: 'Haydut Avı',
                requiredLevel: 5,
                gold: 80,
                exp: 35,
                hpCost: 15
            },
            3: {
                name: 'Kervan Muhafızlığı',
                requiredLevel: 10,
                gold: 140,
                exp: 55,
                hpCost: 20
            },
            4: {
                name: 'Sınır Karakolu',
                requiredLevel: 20,
                gold: 220,
                exp: 80,
                hpCost: 30
            },
            5: {
                name: 'Asi Beyliği Baskını',
                requiredLevel: 30,
                gold: 320,
                exp: 115,
                hpCost: 40
            },
            6: {
                name: 'Düşman Casusları',
                requiredLevel: 40,
                gold: 450,
                exp: 160,
                hpCost: 50
            },
            7: {
                name: 'Şehzade Konvoyu',
                requiredLevel: 50,
                gold: 600,
                exp: 220,
                hpCost: 65
            },
            8: {
                name: 'Düşman Erzak Hattı',
                requiredLevel: 60,
                gold: 800,
                exp: 300,
                hpCost: 80
            },
            9: {
                name: 'Han Ordusu Seferi',
                requiredLevel: 75,
                gold: 1100,
                exp: 420,
                hpCost: 100
            },
            10: {
                name: 'Taht Yolu Muharebesi',
                requiredLevel: 90,
                gold: 1500,
                exp: 600,
                hpCost: 125
            }
        };

        const questId = Number.parseInt(data?.questId, 10);
        const quest = quests[questId];

        if (!quest) {
            return socket.emit('questResult', {
                success: false,
                userData: user,
                message: "Geçersiz görev seçimi."
            });
        }

        if ((Number(user.level) || 1) < quest.requiredLevel) {
            return socket.emit('questResult', {
                success: false,
                userData: user,
                message:
                    `🔒 ${quest.name} için en az Seviye ${quest.requiredLevel} olmalısın.`
            });
        }

        // Göreve çıkmadan önce yeterli can şartı.
        if ((Number(user.hp) || 0) < quest.hpCost) {
            return socket.emit('questResult', {
                success: false,
                userData: user,
                message:
                    `❤️ ${quest.name} için yeterli canın yok! ` +
                    `En az ${quest.hpCost} HP gerekiyor. Mevcut HP: ${user.hp || 0}.`
            });
        }

        // Sefer hakkı sadece gerçekten başlatılan görevde harcanır.
        user.seferLimiti -= 1;

        // İlk eksilen hak ile birlikte 3 dakikalık yenilenme sayacı başlar.
        // Sayaç zaten çalışıyorsa tekrar sıfırlanmaz.
        if (user.seferLimiti < MAX_SEFER_LIMITI && !user.seferNextRefill) {
            user.seferNextRefill = Date.now() + REFILL_INTERVAL;
        }

        user.balance += quest.gold;

        if (user.level < MAX_LEVEL) {
            user.exp += quest.exp;
        }

        user.hp = Math.max(0, user.hp - quest.hpCost);

        const progression = processLevelUps(user);

        recordAdventureProgress(
            user,
            'quest',
            1,
            2
        );

        let questMessage =
            `✅ ${quest.name} başarıyla tamamlandı! ` +
            `🪙 +${quest.gold.toLocaleString('tr-TR')} Altın | ` +
            `✨ +${quest.exp} Tecrübe | ` +
            `❤️ -${quest.hpCost} HP.`;

        if (progression.levelUps > 0) {
            questMessage +=
                ` 🎉 ${progression.levelUps} seviye atladın! Yeni seviyen: ${progression.level}.`;
        }

        if (progression.titleChanged) {
            questMessage +=
                ` 🏅 Yeni Ünvan kazandın: ${progression.newTitle}!`;
        }

        if (progression.reachedMax) {
            questMessage +=
                ` 👑 Maksimum seviye ${MAX_LEVEL}!`;
        }

        await user.save();

        socket.emit('questResult', {
            success: true,
            userData: user,
            questId,
            message: questMessage
        });
    });

    socket.on('advanceDungeonFloor', async () => {
        if (!checkRateLimit(socket.id)) return;
        const user = users[socket.id];
        if (!user) return;

        const currentFloor = user.dungeonFloor || 1;
        const requiredRubies = currentFloor * 5;

        if ((user.rubies || 0) < requiredRubies) {
            return socket.emit('dungeonResult', { 
                success: false, 
                userData: user, 
                message: `Yetersiz Yakut! ${currentFloor}. kattan bir üst kata geçmek için ${requiredRubies} Yakut 💎 gerekiyor. (Mevcut: ${user.rubies || 0} Yakut)` 
            });
        }

        user.rubies -= requiredRubies;
        user.dungeonFloor = currentFloor + 1;

        await user.save();
        socket.emit('dungeonResult', { 
            success: true, 
            userData: user, 
            message: `🚀 Başarıyla Kat ${user.dungeonFloor}'e yükseldiniz! Harcanan Yakut: ${requiredRubies} 💎` 
        });
    });

    socket.on('doDungeon', async (data) => {
        if (!checkRateLimit(socket.id)) return;
        const user = users[socket.id];
        if (!user) return;

        checkDungeonDailyReset(user);

        const floor = Number.parseInt(data?.floor, 10);
        if (!Number.isInteger(floor) || floor < 1 || floor > 10) {
            return socket.emit('dungeonResult', { success: false, userData: user, outcome: 'invalid', message: "Geçersiz zindan katı!" });
        }

        const floorAttemptIndex = floor - 1;
        const usedAttempts = Number(user.dungeonDailyAttempts?.[floorAttemptIndex]) || 0;
        const remainingAttempts = Math.max(0, DUNGEON_DAILY_LIMIT - usedAttempts);

        if (remainingAttempts <= 0) {
            return socket.emit('dungeonResult', {
                success: false,
                userData: user,
                floor,
                outcome: 'daily_limit',
                remainingAttempts: 0,
                message: `⏳ GÜNLÜK SALDIRI LİMİTİ DOLDU! ${floor}. kat için bugün 5 saldırı hakkını kullandın. Hakların Türkiye saatiyle yeni günde tekrar 5 olur.`
            });
        }

        if (floor > (user.dungeonFloor || 1)) {
            return socket.emit('dungeonResult', { success: false, userData: user, floor, outcome: 'locked', message: "🔒 Bu kata henüz erişiminiz yok! Önce katın kilidini açmalısınız." });
        }

        const floors = {
            1:  { requiredStr: 50,   hp: 20,  gold: 100,  exp: 40,   keys: 1 },
            2:  { requiredStr: 100,  hp: 45,  gold: 250,  exp: 90,   keys: 1 },
            3:  { requiredStr: 250,  hp: 90,  gold: 600,  exp: 200,  keys: 1 },
            4:  { requiredStr: 500,  hp: 120, gold: 900,  exp: 320,  keys: 1 },
            5:  { requiredStr: 750,  hp: 150, gold: 1200, exp: 400,  keys: 1 },
            6:  { requiredStr: 1000, hp: 190, gold: 1600, exp: 550,  keys: 1 },
            7:  { requiredStr: 1500, hp: 240, gold: 2100, exp: 700,  keys: 1 },
            8:  { requiredStr: 2000, hp: 300, gold: 2800, exp: 900,  keys: 1 },
            9:  { requiredStr: 3000, hp: 370, gold: 3600, exp: 1150, keys: 1 },
            10: { requiredStr: 5000, hp: 450, gold: 5000, exp: 1800, keys: 2 }
        };
        const f = floors[floor];

        const totalStr = getTotalStr(user);

        if (totalStr < f.requiredStr) {
            return socket.emit('dungeonResult', {
                success: false, userData: user, floor, totalStr, requiredStr: f.requiredStr,
                successChance: 0, outcome: 'insufficient_str',
                message: `⛔ SALDIRI BAŞLATILAMADI! ${floor}. kat için en az ${f.requiredStr} STR gerekiyor. Senin toplam gücün: ${totalStr} STR.`
            });
        }

        if (user.hp < f.hp) {
            return socket.emit('dungeonResult', {
                success: false, userData: user, floor, totalStr, requiredStr: f.requiredStr,
                successChance: 0, outcome: 'insufficient_hp',
                message: `❤️ Canın çok az! ${floor}. kata saldırmak için en az ${f.hp} HP gerekiyor. Mevcut HP: ${user.hp}.`
            });
        }

        // Gerçek saldırı bu noktada başlar; başarılı veya başarısız her savaş 1 günlük hak tüketir.
        user.dungeonDailyAttempts[floorAttemptIndex] = usedAttempts + 1;
        user.markModified('dungeonDailyAttempts');

        const remainingAfterAttack = Math.max(0, DUNGEON_DAILY_LIMIT - user.dungeonDailyAttempts[floorAttemptIndex]);

        const ratio = totalStr / f.requiredStr;
        const successChance = Math.min(95, Math.max(55, 55 + ((ratio - 1) * 35)));
        const roll = Math.random() * 100;
        const won = roll <= successChance;

        user.hp = Math.max(0, user.hp - f.hp);

        recordAdventureProgress(
            user,
            'dungeon_attack',
            1,
            3
        );

        if (!won) {
            await user.save();
            return socket.emit('dungeonResult', {
                success: false, userData: user, floor, totalStr, requiredStr: f.requiredStr,
                successChance: Number(successChance.toFixed(1)), roll: Number(roll.toFixed(1)), outcome: 'defeat',
                remainingAttempts: remainingAfterAttack,
                message: `💀 KAT TEMİZLEME BAŞARISIZ! ${floor}. katta geri püskürtüldün. ⚔️ Gücün: ${totalStr} STR | 🎯 Başarı: %${successChance.toFixed(1)} | 🎲 Savaş atışı: %${roll.toFixed(1)} | ❤️ -${f.hp} HP | ❌ Ödül kazanılmadı. | 🕒 Bugün kalan saldırı: ${remainingAfterAttack}/5`
            });
        }

        user.balance += f.gold;
        if (user.level < MAX_LEVEL) user.exp += f.exp;
        user.goldKeys = (user.goldKeys || 0) + f.keys;
        let bonusMessage = ` 🔑 +${f.keys} Altın Anahtar!`;

        if (floor === 10) {
            user.rubies += 2;
            bonusMessage += " 💎 +2 Yakut!";
        }

        if (Math.random() < 0.35) {
            const dungeonItems = [
                { id: 'dg_sword', name: 'Zindan Kılıcı', icon: '🗡️', type: 'weapon', baseStr: 6, baseVit: 2 },
                { id: 'dg_shield', name: 'Karanlık Kalkan', icon: '🛡', type: 'shield', baseStr: 2, baseVit: 6 },
                { id: 'dg_ring', name: 'Ruh Yüzüğü', icon: '💍', type: 'ring', baseStr: 4, baseVit: 4 }
            ];
            const base = dungeonItems[Math.floor(Math.random() * dungeonItems.length)];
            const wonItem = {
                id: `${base.id}_${Date.now()}`,
                name: base.name,
                icon: base.icon,
                type: base.type,
                source: `${floor}. Kat Zindan`,
                level: 1,
                rarity: 'Nadir',
                strBonus: base.baseStr * 2,
                vitBonus: base.baseVit * 2
            };
            user.inventory.push(wonItem);
            user.markModified('inventory');
            bonusMessage += ` 🎁 [Nadir] ${wonItem.name} +1 düştü!`;
        }

        if (floor === 10) {
            user.dungeonBossWins = (user.dungeonBossWins || 0) + 1;

            const legendaryDrop = tryGrantHukumdarSetPiece(
                user,
                0.03,
                '10. Kat Zindan Final Boss'
            );

            if (legendaryDrop) {
                bonusMessage +=
                    ` 👑 EFSANEVİ GANİMET! [Hükümdar Seti] ${legendaryDrop.name} düştü!`;
            }
        }

        const progression = processLevelUps(user);
        if (progression.levelUps > 0) {
            bonusMessage += ` ✨ ${progression.levelUps} seviye atladın! Yeni seviyen: ${progression.level}.`;
        }
        if (progression.titleChanged) {
            bonusMessage += ` 🏅 Yeni Ünvan: ${progression.newTitle}!`;
        }
        if (progression.reachedMax) {
            bonusMessage += ` 👑 Maksimum seviye ${MAX_LEVEL}!`;
        }

        await user.save();
        socket.emit('dungeonResult', {
            success: true, userData: user, floor, totalStr, requiredStr: f.requiredStr,
            successChance: Number(successChance.toFixed(1)), roll: Number(roll.toFixed(1)), outcome: 'victory',
            remainingAttempts: remainingAfterAttack,
            message: `🏆 KAT TEMİZLEME BAŞARILI! ${floor}. kat temizlendi. ⚔️ Gücün: ${totalStr} STR | 🎯 Başarı: %${successChance.toFixed(1)} | 🎲 Savaş atışı: %${roll.toFixed(1)} | ❤️ -${f.hp} HP | 💰 +${f.gold} Altın | ⭐ +${f.exp} Tecrübe.${bonusMessage} | 🕒 Bugün kalan saldırı: ${remainingAfterAttack}/5`
        });
    });



    // --- KIŞLA / KALE / TAHT SAVAŞI SİSTEMİ ---
    async function getBarracksStatusPayload(user) {
        normalizeArmy(user);
        normalizeTimarState(user);

        const castle = await getCastleStatusForUser(user);
        const troopPower = getArmyPower(user.army);
        const commanderStr = getTotalStr(user);
        const armyPower = troopPower + commanderStr;
        const cavalryDiscount = getTimarCavalryDiscount(user);

        const troops = {
            archer: { ...TROOP_TYPES.archer },
            warrior: { ...TROOP_TYPES.warrior },
            cavalry: {
                ...TROOP_TYPES.cavalry,
                baseCost: TROOP_TYPES.cavalry.cost,
                cost: Math.max(1, Math.floor(TROOP_TYPES.cavalry.cost * (1 - cavalryDiscount))),
                discountPercent: Math.round(cavalryDiscount * 100)
            },
            catapult: { ...TROOP_TYPES.catapult }
        };

        return {
            userData: user,
            troops,
            castle,
            troopPower,
            commanderStr,
            armyPower,
            armyCount: getArmyCount(user.army),
            cavalryDiscountPercent: Math.round(cavalryDiscount * 100)
        };
    }

    socket.on('getBarracksStatus', async () => {
        if (!checkRateLimit(socket.id)) return;
        const user = users[socket.id];
        if (!user) return;

        try {
            const payload = await getBarracksStatusPayload(user);
            await user.save();
            socket.emit('barracksStatus', payload);
        } catch (err) {
            console.error('Kışla durumu hatası:', err);
            socket.emit('barracksResult', {
                success: false,
                userData: user,
                message: 'Kışla bilgileri yüklenemedi.'
            });
        }
    });

    socket.on('trainTroops', async (data) => {
        if (!checkRateLimit(socket.id)) return;

        const user = users[socket.id];
        if (!user) return;

        try {
            normalizeArmy(user);

            const troopType = String(data?.troopType || '');
            const troop = TROOP_TYPES[troopType];
            const quantity = Number.parseInt(data?.quantity, 10);

            if (!troop) {
                return socket.emit('barracksResult', {
                    success: false,
                    userData: user,
                    message: 'Geçersiz asker türü.'
                });
            }

            if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
                return socket.emit('barracksResult', {
                    success: false,
                    userData: user,
                    message: 'Tek seferde 1 ile 100 arasında birlik üretebilirsin.'
                });
            }

            normalizeTimarState(user);

            const cavalryDiscount =
                troopType === 'cavalry'
                    ? getTimarCavalryDiscount(user)
                    : 0;

            const effectiveUnitCost = Math.max(
                1,
                Math.floor(troop.cost * (1 - cavalryDiscount))
            );

            const totalCost = effectiveUnitCost * quantity;

            if ((user.balance || 0) < totalCost) {
                return socket.emit('barracksResult', {
                    success: false,
                    userData: user,
                    message:
                        `🪙 Yetersiz altın! ${quantity} ${troop.name} için ` +
                        `${totalCost.toLocaleString('tr-TR')} Altın gerekiyor.`
                });
            }

            user.balance -= totalCost;
            user.army[troopType] = (Number(user.army[troopType]) || 0) + quantity;
            user.markModified('army');

            recordAdventureProgress(
                user,
                'train_troop',
                quantity,
                Math.max(
                    1,
                    Math.floor(quantity / 10)
                )
            );

            await user.save();

            const castle = await getCastleStatusForUser(user);

            const troopPower = getArmyPower(user.army);
            const commanderStr = getTotalStr(user);
            const armyPower = troopPower + commanderStr;

            socket.emit('barracksResult', {
                success: true,
                userData: user,
                castle,
                troopPower,
                commanderStr,
                armyPower,
                armyCount: getArmyCount(user.army),
                message:
                    `${troop.icon} ${quantity} ${troop.name} ${troopType === 'catapult' ? 'inşa edildi' : 'yetiştirildi'}! ` +
                    `🪙 ${totalCost.toLocaleString('tr-TR')} Altın harcandı. ` +
                    `${troopType === 'cavalry' && cavalryDiscount > 0
                        ? `🐎 Ahır indirimi: %${Math.round(cavalryDiscount * 100)}. `
                        : ''}` +
                    `⚔️ Toplam Ordu Gücü: ${armyPower.toLocaleString('tr-TR')} ` +
                    `(Birlik ${troopPower.toLocaleString('tr-TR')} + Komutan STR ${commanderStr.toLocaleString('tr-TR')}).`
            });

            // Taht sahibi asker yetiştirirse kalenin savunması da anında değişir.
            if (castle.isOwner) {
                io.emit('castleRefresh');
            }
        } catch (err) {
            console.error('Asker yetiştirme hatası:', err);
            socket.emit('barracksResult', {
                success: false,
                userData: user,
                message: 'Asker yetiştirme sırasında hata oluştu.'
            });
        }
    });

    socket.on('attackCastle', async () => {
        if (!checkRateLimit(socket.id)) return;

        const user = users[socket.id];
        if (!user) return;

        if (castleBattleLock) {
            return socket.emit('castleBattleResult', {
                success: false,
                userData: user,
                message: '⚔️ Kalede başka bir savaş sonuçlandırılıyor. Birkaç saniye sonra tekrar dene.'
            });
        }

        castleBattleLock = true;

        try {
            normalizeArmy(user);
            normalizeSiegeMarketState(user);

            const attackerArmy = cloneArmy(user.army);
            const attackerTroopPower = getArmyPower(attackerArmy);

            const preparationsUsed = {
                armyRations: Boolean(user.siegePreparations.armyRations),
                warDrum: Boolean(user.siegePreparations.warDrum),
                commanderEdict: Boolean(user.siegePreparations.commanderEdict)
            };

            // Oyuncunun ekipman dahil toplam STR değeri ordusuna eklenir.
            const attackerCommanderStr = getTotalStr(user);

            const effectiveCommanderStr = preparationsUsed.commanderEdict
                ? Math.floor(attackerCommanderStr * 1.25)
                : attackerCommanderStr;

            const attackerPowerBeforeDrum =
                attackerTroopPower + effectiveCommanderStr;

            // Savaş Davulu bir sonraki kuşatmada toplam saldırı gücüne %5 verir.
            const setBonuses = getHukumdarSetBonusState(user);

            const attackerPowerWithDrum = preparationsUsed.warDrum
                ? Math.floor(attackerPowerBeforeDrum * 1.05)
                : attackerPowerBeforeDrum;

            const attackerBasePower = setBonuses.castleAttackPercent > 0
                ? Math.floor(
                    attackerPowerWithDrum *
                    (1 + (setBonuses.castleAttackPercent / 100))
                )
                : attackerPowerWithDrum;

            if (
                attackerTroopPower <= 0 ||
                getArmyCount(attackerArmy) <= 0
            ) {
                return socket.emit('castleBattleResult', {
                    success: false,
                    userData: user,
                    message: '🛡️ Kaleye saldırmak için önce Kışla’dan asker yetiştirmelisin.'
                });
            }

            const castle = await getOrCreateCastle();

            if (
                castle.ownerId &&
                String(castle.ownerId) === String(user._id)
            ) {
                return socket.emit('castleBattleResult', {
                    success: false,
                    userData: user,
                    message: '👑 Bu kale zaten senin. Kendi tahtına saldıramazsın.'
                });
            }

            let defenderUser = null;
            let defenderArmy = cloneArmy(NPC_CASTLE_ARMY);
            let defenderName = 'Saray Muhafızları';
            let defenderIsNpc = true;
            let defenderCommanderStr = 0;

            if (castle.ownerId) {
                defenderUser = await User.findById(castle.ownerId);

                if (!defenderUser) {
                    castle.ownerId = null;
                    castle.ownerName = '';
                    castle.conqueredAt = 0;
                    await castle.save();
                } else {
                    normalizeArmy(defenderUser);
                    defenderArmy = cloneArmy(defenderUser.army);
                    defenderName = defenderUser.username;
                    defenderIsNpc = false;

                    // Taht sahibinin STR değeri de savunma ordusuna eklenir.
                    defenderCommanderStr = getTotalStr(defenderUser);
                }
            }

            const defenderTroopPower = getArmyPower(defenderArmy);
            const defenderCombinedArmyPower =
                defenderTroopPower + defenderCommanderStr;

            const defenderBasePower = Math.floor(
                (
                    defenderCombinedArmyPower +
                    CASTLE_WALL_POWER
                ) *
                CASTLE_DEFENSE_BONUS
            );

            // Savaşta iki taraf da %90–110 performans gösterebilir.
            const attackerRollMultiplier =
                0.90 + (Math.random() * 0.20);

            const defenderRollMultiplier =
                0.90 + (Math.random() * 0.20);

            const attackerBattlePower = Math.max(
                1,
                Math.floor(
                    attackerBasePower *
                    attackerRollMultiplier
                )
            );

            const defenderBattlePower = Math.max(
                1,
                Math.floor(
                    defenderBasePower *
                    defenderRollMultiplier
                )
            );

            const attackerWon =
                attackerBattlePower > defenderBattlePower;

            // Kazanan da kayıp verir; kaybeden taraf daha ağır kayıp verir.
            let attackerLossRate = attackerWon
                ? 0.15 + (Math.random() * 0.20)   // %15–35
                : 0.45 + (Math.random() * 0.30); // %45–75

            // Ordu Erzağı asker kaybını %10 azaltır.
            if (preparationsUsed.armyRations) {
                attackerLossRate *= 0.90;
            }

            const defenderLossRate = attackerWon
                ? 0.55 + (Math.random() * 0.30)  // %55–85
                : 0.10 + (Math.random() * 0.20); // %10–30

            const attackerLossResult = applyArmyLosses(
                attackerArmy,
                attackerLossRate
            );

            const defenderLossResult = applyArmyLosses(
                defenderArmy,
                defenderLossRate
            );

            user.army.archer = attackerLossResult.after.archer;
            user.army.warrior = attackerLossResult.after.warrior;
            user.army.cavalry = attackerLossResult.after.cavalry;
            user.army.catapult = attackerLossResult.after.catapult;

            user.lastCastleLosses = {
                archer: attackerLossResult.lost.archer || 0,
                warrior: attackerLossResult.lost.warrior || 0,
                cavalry: attackerLossResult.lost.cavalry || 0,
                catapult: attackerLossResult.lost.catapult || 0,
                available:
                    (
                        (attackerLossResult.lost.archer || 0) +
                        (attackerLossResult.lost.warrior || 0) +
                        (attackerLossResult.lost.cavalry || 0) +
                        (attackerLossResult.lost.catapult || 0)
                    ) > 0
            };

            // Hazırlık ürünleri bu gerçek kuşatmada tüketilir.
            user.siegePreparations.armyRations = false;
            user.siegePreparations.warDrum = false;
            user.siegePreparations.commanderEdict = false;

            user.markModified('army');
            user.markModified('lastCastleLosses');
            user.markModified('siegePreparations');

            if (defenderUser) {
                defenderUser.army.archer =
                    defenderLossResult.after.archer;

                defenderUser.army.warrior =
                    defenderLossResult.after.warrior;

                defenderUser.army.cavalry =
                    defenderLossResult.after.cavalry;

                defenderUser.army.catapult =
                    defenderLossResult.after.catapult;

                normalizeSiegeMarketState(defenderUser);

                defenderUser.lastCastleLosses = {
                    archer: defenderLossResult.lost.archer || 0,
                    warrior: defenderLossResult.lost.warrior || 0,
                    cavalry: defenderLossResult.lost.cavalry || 0,
                    catapult: defenderLossResult.lost.catapult || 0,
                    available:
                        (
                            (defenderLossResult.lost.archer || 0) +
                            (defenderLossResult.lost.warrior || 0) +
                            (defenderLossResult.lost.cavalry || 0) +
                            (defenderLossResult.lost.catapult || 0)
                        ) > 0
                };

                defenderUser.markModified('army');
                defenderUser.markModified('lastCastleLosses');

                await defenderUser.save();
            }

            castle.battleCount =
                (castle.battleCount || 0) + 1;

            let message = '';
            let throneChanged = false;

            const conquestGoldReward =
                attackerWon ? 10000 : 0;

            const conquestRubyReward =
                attackerWon ? 100 : 0;

            if (attackerWon) {
                throneChanged = true;

                const oldOwnerName =
                    castle.ownerName || 'Saray Muhafızları';

                castle.ownerId = user._id;
                castle.ownerName = user.username;
                castle.conqueredAt = Date.now();

                user.castleVictories =
                    (user.castleVictories || 0) + 1;

                user.balance =
                    (user.balance || 0) +
                    conquestGoldReward;

                user.rubies =
                    (user.rubies || 0) +
                    conquestRubyReward;

                const legendaryDrop = tryGrantHukumdarSetPiece(
                    user,
                    0.05,
                    'Kale Fethi'
                );

                message =
                    `👑 KALE FETHEDİLDİ! ${user.username} kaleyi ele geçirdi ve TAHTIN yeni sahibi oldu! ` +
                    `🎁 Fetih Ödülü: +${conquestGoldReward.toLocaleString('tr-TR')} Altın 🪙 ve +${conquestRubyReward} Yakut 💎. ` +
                    (legendaryDrop
                        ? `👑 EFSANEVİ GANİMET! [Hükümdar Seti] ${legendaryDrop.name} düştü! `
                        : '') +
                    `⚔️ Savaş Gücü: ${attackerBattlePower.toLocaleString('tr-TR')} ` +
                    `(Birlik ${attackerTroopPower.toLocaleString('tr-TR')} + STR ${effectiveCommanderStr.toLocaleString('tr-TR')}${preparationsUsed.warDrum ? ' + Davul %5' : ''}) ` +
                    `vs ${defenderBattlePower.toLocaleString('tr-TR')} (${oldOwnerName}). ` +
                    `Kayıpların: ${formatArmyLosses(attackerLossResult.lost)}.`;

                if (defenderUser) {
                    syncOnlineArmy(
                        defenderUser._id,
                        defenderLossResult.after,
                        `💥 ${user.username} kalene saldırdı ve tahtı ele geçirdi! ` +
                        `Kayıpların: ${formatArmyLosses(defenderLossResult.lost)}.`
                    );
                }
            } else {
                message =
                    `❌ KUŞATMA BAŞARISIZ! ${defenderName} kaleyi savundu. ` +
                    `⚔️ Savaş Gücü: ${attackerBattlePower.toLocaleString('tr-TR')} ` +
                    `(Birlik ${attackerTroopPower.toLocaleString('tr-TR')} + STR ${effectiveCommanderStr.toLocaleString('tr-TR')}${preparationsUsed.warDrum ? ' + Davul %5' : ''}) ` +
                    `vs ${defenderBattlePower.toLocaleString('tr-TR')}. ` +
                    `Kayıpların: ${formatArmyLosses(attackerLossResult.lost)}.`;

                if (defenderUser) {
                    syncOnlineArmy(
                        defenderUser._id,
                        defenderLossResult.after,
                        `🛡️ ${user.username} kalene saldırdı fakat savunmayı geçemedi. ` +
                        `Savunma kayıpların: ${formatArmyLosses(defenderLossResult.lost)}.`
                    );
                }
            }

            await user.save();
            await castle.save();

            const updatedCastle =
                await getCastleStatusForUser(user);

            // Animasyonda kullanılacak savaş safhaları.
            // Sonuç yine tamamen sunucuda hesaplanmıştır.
            const battlePhases = [
                {
                    id: 'archery',
                    icon: '🏹',
                    name: 'Okçu Yaylımı',
                    attackerUnits: attackerArmy.archer,
                    defenderUnits: defenderArmy.archer
                },
                {
                    id: 'catapult',
                    icon: '🏗️',
                    name: 'Mancınık Bombardımanı',
                    attackerUnits: attackerArmy.catapult,
                    defenderUnits: defenderArmy.catapult
                },
                {
                    id: 'infantry',
                    icon: '⚔️',
                    name: 'Piyade Çarpışması',
                    attackerUnits: attackerArmy.warrior,
                    defenderUnits: defenderArmy.warrior
                },
                {
                    id: 'cavalry',
                    icon: '🐎',
                    name: 'Süvari Hücumu',
                    attackerUnits: attackerArmy.cavalry,
                    defenderUnits: defenderArmy.cavalry
                },
                {
                    id: 'final',
                    icon: '🧱',
                    name: 'Son Taarruz',
                    attackerUnits: getArmyCount(attackerArmy),
                    defenderUnits: getArmyCount(defenderArmy)
                }
            ];

            socket.emit('castleBattleResult', {
                success: attackerWon,
                battleCompleted: true,
                throneChanged,
                userData: user,
                castle: updatedCastle,
                attackerBattlePower,
                defenderBattlePower,
                attackerLosses: attackerLossResult.lost,
                defenderLosses: defenderLossResult.lost,
                message,

                battle: {
                    attackerWon,
                    throneChanged,

                    attacker: {
                        username: user.username,
                        army: attackerArmy,
                        troopPower: attackerTroopPower,
                        commanderStr: attackerCommanderStr,
                        effectiveCommanderStr,
                        basePower: attackerBasePower,
                        setCastleBonusPercent: setBonuses.castleAttackPercent,
                        preparationsUsed,
                        battlePower: attackerBattlePower,
                        losses: attackerLossResult.lost,
                        remainingArmy: attackerLossResult.after
                    },

                    defender: {
                        username: defenderName,
                        isNpc: defenderIsNpc,
                        army: defenderArmy,
                        troopPower: defenderTroopPower,
                        commanderStr: defenderCommanderStr,
                        basePower: defenderBasePower,
                        battlePower: defenderBattlePower,
                        wallPower: CASTLE_WALL_POWER,
                        defenseBonusPercent:
                            Math.round(
                                (CASTLE_DEFENSE_BONUS - 1) * 100
                            ),
                        losses: defenderLossResult.lost,
                        remainingArmy: defenderLossResult.after
                    },

                    phases: battlePhases,

                    rewards: {
                        gold: conquestGoldReward,
                        rubies: conquestRubyReward
                    }
                }
            });

            // Diğer oyuncular kalenin yeni durumunu görsün.
            // Saldıran oyuncu animasyon bitince kendi durumunu ayrıca yeniler.
            socket.broadcast.emit('castleRefresh');

            if (throneChanged) {
                io.emit('throneAnnouncement', {
                    ownerName: user.username,
                    message:
                        `👑 ${user.username} kaleyi ele geçirdi ve Tahtın yeni sahibi oldu!`
                });
            }
        } catch (err) {
            console.error('Kale savaşı hatası:', err);

            socket.emit('castleBattleResult', {
                success: false,
                userData: user,
                message: 'Kale savaşı sırasında bir hata oluştu.'
            });
        } finally {
            castleBattleLock = false;
        }
    });

    // --- METİN TAŞI KES SİSTEMİ ---
    socket.on('getMetinStatus', async () => {
        const user = users[socket.id];
        if (!user) return;

        normalizeMetinState(user);
        await user.save();

        socket.emit('metinStatus', {
            userData: user,
            stones: METIN_STONES
        });
    });

    socket.on('attackMetinStone', async (data) => {
        if (!checkRateLimit(socket.id)) return;

        const user = users[socket.id];
        if (!user) return;

        normalizeMetinState(user);

        const stoneId = Number.parseInt(data?.stoneId, 10);
        const stone = METIN_STONES[stoneId];

        if (!stone) {
            return socket.emit('metinResult', {
                success: false,
                userData: user,
                message: 'Geçersiz Metin Taşı!'
            });
        }

        if ((Number(user.level) || 1) < stone.requiredLevel) {
            return socket.emit('metinResult', {
                success: false,
                userData: user,
                stoneId,
                message: `🔒 ${stone.name} için en az Seviye ${stone.requiredLevel} olmalısın.`
            });
        }

        const index = stoneId - 1;
        const now = Date.now();

        let currentHp = Number(user.metinStoneHp[index]);
        if (!Number.isFinite(currentHp)) currentHp = stone.maxHp;

        const respawnAt = Number(user.metinStoneRespawnAt[index]) || 0;

        if (currentHp <= 0 && respawnAt > now) {
            const seconds = Math.ceil((respawnAt - now) / 1000);

            return socket.emit('metinResult', {
                success: false,
                userData: user,
                stoneId,
                message: `⏳ ${stone.name} yeniden doğuyor. Yaklaşık ${seconds} saniye kaldı.`
            });
        }

        const totalStr = getTotalStr(user);

        // Her gerçek Metin saldırısı oyuncudan can götürür.
        // Maliyet, kuşanılmış ekipman VIT bonusları dahil maksimum HP üzerinden hesaplanır.
        const maxPlayerHp = calculateMaxHpForProgression(user);
        const playerHpCost = Math.max(
            1,
            Math.ceil(maxPlayerHp * (stone.hpCostPercent / 100))
        );

        if ((Number(user.hp) || 0) < playerHpCost) {
            return socket.emit('metinResult', {
                success: false,
                userData: user,
                stoneId,
                hpCost: playerHpCost,
                message: `❤️ Canın yetersiz! ${stone.name}'ne vurmak için en az ${playerHpCost} HP gerekiyor. Mevcut HP: ${user.hp || 0}.`
            });
        }

        // Toplam STR x4, vuruş başına ±%15 değişken hasar.
        const randomMultiplier = 0.85 + (Math.random() * 0.30);
        const rawDamage = Math.max(1, Math.floor(totalStr * 4 * randomMultiplier));
        const damage = Math.min(rawDamage, currentHp);
        const newHp = Math.max(0, currentHp - damage);

        user.hp = Math.max(0, (Number(user.hp) || 0) - playerHpCost);
        user.metinStoneHp[index] = newHp;
        user.markModified('metinStoneHp');

        let destroyed = false;
        let papersDropped = 0;
        let message =
            `⚔️ ${stone.name}'ne ${damage} hasar verdin! ` +
            `🪨 Metin HP: ${newHp}/${stone.maxHp} | ` +
            `❤️ -${playerHpCost} HP (Kalan: ${user.hp}/${maxPlayerHp})`;

        if (newHp <= 0) {
            destroyed = true;

            user.metinStoneRespawnAt[index] = now + stone.respawnMs;
            user.markModified('metinStoneRespawnAt');

            papersDropped = stone.papers;

            if (stoneId === 3 && Math.random() < 0.25) papersDropped += 1;
            if (stoneId === 4 && Math.random() < 0.40) papersDropped += 1;
            if (stoneId === 5 && Math.random() < 0.50) papersDropped += 1;

            for (let i = 0; i < papersDropped; i++) {
                user.inventory.push(createBlessingPaper());
            }

            user.metinKills = (user.metinKills || 0) + 1;

            recordAdventureProgress(
                user,
                'metin_kill',
                1,
                5
            );

            let legendaryDrop = null;

            if (stoneId === 5) {
                legendaryDrop = tryGrantHukumdarSetPiece(
                    user,
                    0.04,
                    'Taht Metini'
                );
            }

            user.markModified('inventory');

            const respawnHours = Math.ceil(stone.respawnMs / (60 * 60 * 1000));

            message =
                `💥 ${stone.name} parçalandı! ` +
                `❤️ -${playerHpCost} HP (Kalan: ${user.hp}/${maxPlayerHp}) | ` +
                `📜 ${papersDropped} adet Kutsama Kağıdı envanterine eklendi. ` +
                (legendaryDrop
                    ? `👑 EFSANEVİ GANİMET! [Hükümdar Seti] ${legendaryDrop.name} düştü! `
                    : '') +
                `⏳ Metin yaklaşık ${respawnHours} saat sonra yeniden doğacak.`;
        }

        await user.save();

        socket.emit('metinResult', {
            success: true,
            userData: user,
            stoneId,
            totalStr,
            damage,
            hpCost: playerHpCost,
            playerHp: user.hp,
            playerMaxHp: maxPlayerHp,
            destroyed,
            papersDropped,
            message
        });
    });

    // --- KAVŞAK PAZARI (OYUNCU TEZGAHLARI) SİSTEMİ ---
    socket.on('getCharacterMarket', async () => {
        const user = users[socket.id];
        try {
            const stalls = await Stall.find().sort({ locationRank: 1 });
            const myStall = user ? await Stall.findOne({ ownerId: user._id }) : null;
            socket.emit('characterMarketData', { stalls, myStall });
        } catch (err) {
            console.error(err);
        }
    });

    socket.on('createStall', async ({ locationRank }) => {
        const user = users[socket.id];
        if (!user) return;
        try {
            let existing = await Stall.findOne({ ownerId: user._id });
            if (existing) return socket.emit('marketMessage', { success: false, userData: user, message: "Zaten bir tezgahınız var!" });
            
            const newStall = new Stall({
                ownerId: user._id,
                characterName: user.username,
                locationRank: parseInt(locationRank) || 1,
                inventory: [],
                gold: 0
            });
            await newStall.save();
            socket.emit('marketMessage', { success: true, userData: user, message: "Beypazarı'nda tezgahınız başarıyla kuruldu!" });
        } catch (err) {
            socket.emit('marketMessage', { success: false, userData: user, message: "Tezgah kurulurken bir hata oluştu." });
        }
    });

    socket.on('addItemToStall', async ({ itemIndex, price, currency }) => {
        const user = users[socket.id];
        if (!user) return;

        const safeIndex = Number.parseInt(itemIndex, 10);
        const safePrice = Number.parseInt(price, 10);
        const safeCurrency = currency === 'ruby' ? 'ruby' : 'gold';

        if (!Number.isInteger(safeIndex) || safeIndex < 0 || !user.inventory[safeIndex]) {
            return socket.emit('marketMessage', {
                success: false,
                userData: user,
                message: "Geçersiz eşya seçimi!"
            });
        }

        if (!Number.isInteger(safePrice) || safePrice <= 0 || safePrice > 100000000) {
            return socket.emit('marketMessage', {
                success: false,
                userData: user,
                message: "Satış fiyatı 1 ile 100.000.000 arasında olmalıdır."
            });
        }

        try {
            const stall = await Stall.findOne({ ownerId: user._id });
            if (!stall) {
                return socket.emit('marketMessage', {
                    success: false,
                    userData: user,
                    message: "Önce bir tezgah açmalısınız!"
                });
            }

            const item = user.inventory.splice(safeIndex, 1)[0];
            stall.inventory.push({
                item,
                price: safePrice,
                currency: safeCurrency
            });

            user.markModified('inventory');
            stall.markModified('inventory');

            await user.save();
            await stall.save();

            const currencyText = safeCurrency === 'ruby'
                ? `${safePrice} Yakut 💎`
                : `${safePrice} Altın 🪙`;

            socket.emit('marketMessage', {
                success: true,
                userData: user,
                message: `${item.name} +${Number(item.level) || 0}, ${currencyText} karşılığında Beypazarı'nda satışa konuldu!`
            });
            socket.emit('statUpdated', user);
        } catch (err) {
            console.error(err);
            socket.emit('marketMessage', {
                success: false,
                userData: user,
                message: "Ürün satışa konulurken işlem başarısız oldu."
            });
        }
    });

    socket.on('removeItemFromStall', async ({ stallItemIndex }) => {
        const user = users[socket.id];
        if (!user) return;
        try {
            const stall = await Stall.findOne({ ownerId: user._id });
            if (!stall || !stall.inventory[stallItemIndex]) return;

            const soldObj = stall.inventory.splice(stallItemIndex, 1)[0];
            user.inventory.push(soldObj.item);
            user.markModified('inventory');
            await user.save();
            await stall.save();

            socket.emit('marketMessage', { success: true, userData: user, message: `${soldObj.item.name} tezgahtan geri alındı!` });
            socket.emit('statUpdated', user);
        } catch (err) {
            socket.emit('marketMessage', { success: false, userData: user, message: "İşlem başarısız." });
        }
    });

    socket.on('buyStallItem', async ({ stallId, stallItemIndex }) => {
        const buyer = users[socket.id];
        if (!buyer) return;

        const safeIndex = Number.parseInt(stallItemIndex, 10);
        if (!Number.isInteger(safeIndex) || safeIndex < 0) {
            return socket.emit('marketMessage', {
                success: false,
                userData: buyer,
                message: "Geçersiz ürün seçimi!"
            });
        }

        try {
            const stall = await Stall.findById(stallId);
            if (!stall || !stall.inventory[safeIndex]) {
                return socket.emit('marketMessage', {
                    success: false,
                    userData: buyer,
                    message: "Bu ürün artık mevcut değil!"
                });
            }

            if (stall.ownerId.toString() === buyer._id.toString()) {
                return socket.emit('marketMessage', {
                    success: false,
                    userData: buyer,
                    message: "Kendi ürününüzü satın alamazsınız!"
                });
            }

            const targetObj = stall.inventory[safeIndex];
            const price = Number.parseInt(targetObj.price, 10);
            // Eski ilanlarda currency alanı olmadığı için onları otomatik olarak altın kabul ediyoruz.
            const currency = targetObj.currency === 'ruby' ? 'ruby' : 'gold';

            if (!Number.isInteger(price) || price <= 0) {
                return socket.emit('marketMessage', {
                    success: false,
                    userData: buyer,
                    message: "Ürünün satış fiyatı geçersiz!"
                });
            }

            if (currency === 'ruby') {
                if ((buyer.rubies || 0) < price) {
                    return socket.emit('marketMessage', {
                        success: false,
                        userData: buyer,
                        message: `Yetersiz Yakut! Bu ürün için ${price} Yakut 💎 gerekiyor.`
                    });
                }

                buyer.rubies -= price;
                stall.rubies = (stall.rubies || 0) + price;
            } else {
                if ((buyer.balance || 0) < price) {
                    return socket.emit('marketMessage', {
                        success: false,
                        userData: buyer,
                        message: `Yetersiz Altın! Bu ürün için ${price} Altın 🪙 gerekiyor.`
                    });
                }

                buyer.balance -= price;
                stall.gold = (stall.gold || 0) + price;
            }

            stall.inventory.splice(safeIndex, 1);
            buyer.inventory.push(targetObj.item);

            buyer.markModified('inventory');
            stall.markModified('inventory');

            await buyer.save();
            await stall.save();

            const currencyText = currency === 'ruby'
                ? `${price} Yakut 💎`
                : `${price} Altın 🪙`;

            // Satıcı çevrimiçiyse bilgilendir.
            for (let sId in users) {
                if (users[sId]._id.toString() === stall.ownerId.toString()) {
                    io.to(sId).emit('marketMessage', {
                        success: true,
                        message: `Beypazarı tezgahınızdan ${targetObj.item.name} +${Number(targetObj.item.level) || 0}, ${currencyText} karşılığında satıldı!`
                    });
                }
            }

            socket.emit('marketMessage', {
                success: true,
                userData: buyer,
                message: `${targetObj.item.name} +${Number(targetObj.item.level) || 0}, ${currencyText} karşılığında satın alındı!`
            });
            socket.emit('statUpdated', buyer);
        } catch (err) {
            console.error(err);
            socket.emit('marketMessage', {
                success: false,
                userData: buyer,
                message: "Satın alma işleminde hata oluştu."
            });
        }
    });

    socket.on('collectStallGold', async () => {
        const user = users[socket.id];
        if (!user) return;

        try {
            const stall = await Stall.findOne({ ownerId: user._id });
            if (!stall) {
                return socket.emit('marketMessage', {
                    success: false,
                    userData: user,
                    message: "Tezgah bulunamadı!"
                });
            }

            const collectedGold = Math.max(0, Number(stall.gold) || 0);
            const collectedRubies = Math.max(0, Number(stall.rubies) || 0);

            if (collectedGold <= 0 && collectedRubies <= 0) {
                return socket.emit('marketMessage', {
                    success: false,
                    userData: user,
                    message: "Tezgah kasasında toplanacak Altın veya Yakut yok!"
                });
            }

            stall.gold = 0;
            stall.rubies = 0;

            user.balance += collectedGold;
            user.rubies = (user.rubies || 0) + collectedRubies;

            await user.save();
            await stall.save();

            const parts = [];
            if (collectedGold > 0) parts.push(`${collectedGold} Altın 🪙`);
            if (collectedRubies > 0) parts.push(`${collectedRubies} Yakut 💎`);

            socket.emit('marketMessage', {
                success: true,
                userData: user,
                message: `${parts.join(' ve ')} Beypazarı tezgah kasasından toplandı!`
            });
            socket.emit('statUpdated', user);
        } catch (err) {
            console.error(err);
            socket.emit('marketMessage', {
                success: false,
                userData: user,
                message: "Tezgah kazançları toplanamadı."
            });
        }
    });

    // --- KAVŞAK PAZARI BİTİŞ ---

    socket.on('openGoldChest', async () => {
        if (!checkRateLimit(socket.id)) return;
        const user = users[socket.id];
        if (!user) return;

        if ((user.goldKeys || 0) < 1) {
            return socket.emit('marketResult', { success: false, userData: user, message: "Altın Sandığı açmak için en az 1 adet Altın Anahtarınız olmalı!" });
        }

        user.goldKeys -= 1;
        const rubyWon = 10;
        user.rubies += rubyWon;

        await user.save();
        socket.emit('marketResult', { success: true, userData: user, message: `📦 Altın Sandık açıldı! Envanterinize ${rubyWon} adet Yakut 💎 eklendi!` });
    });

    socket.on('buySuluhanItem', async (data) => {
        if (!checkRateLimit(socket.id)) return;
        const user = users[socket.id];
        if (!user) return;

        const suluhanItems = {
            1: { name: 'Güneş Kılıcı', icon: '⚔️', type: 'weapon', rarity: 'Epik', goldCost: 5000, rubyCost: 1000, strBonus: 12, vitBonus: 4, level: 1 },
            2: { name: 'Vezir Zırhı', icon: '🛡️', type: 'armor', rarity: 'Epik', goldCost: 8000, rubyCost: 750, strBonus: 5, vitBonus: 15, level: 1 },
            3: { name: 'Sultan Tacı', icon: '👑', type: 'helmet', rarity: 'Epik', goldCost: 4000, rubyCost: 450, strBonus: 4, vitBonus: 10, level: 1 },
            4: { name: 'Hünkar Yüzüğü', icon: '💍', type: 'ring', rarity: 'Epik', goldCost: 10000, rubyCost: 300, strBonus: 8, vitBonus: 8, level: 1 },
            5: { name: 'Şehzade Çizmesi', icon: '👢', type: 'boots', rarity: 'Epik', goldCost: 2500, rubyCost: 200, strBonus: 6, vitBonus: 6, level: 1 }
        };

        const itemTemplate = suluhanItems[data.itemId];
        if (!itemTemplate) {
            return socket.emit('suluhanResult', { success: false, userData: user, message: "Geçersiz eşya seçimi!" });
        }

        if (user.balance < itemTemplate.goldCost || (user.rubies || 0) < itemTemplate.rubyCost) {
            return socket.emit('suluhanResult', { 
                success: false, 
                userData: user, 
                message: `Yetersiz kaynak! Bu eşya için ${itemTemplate.goldCost} Altın ve ${itemTemplate.rubyCost} Yakut gerekiyor.` 
            });
        }

        user.balance -= itemTemplate.goldCost;
        user.rubies -= itemTemplate.rubyCost;

        const newItem = {
            id: `suluhan_${data.itemId}_${Date.now()}`,
            name: itemTemplate.name,
            icon: itemTemplate.icon,
            type: itemTemplate.type,
            level: itemTemplate.level,
            rarity: itemTemplate.rarity,
            strBonus: itemTemplate.strBonus,
            vitBonus: itemTemplate.vitBonus
        };

        user.inventory.push(newItem);
        user.markModified('inventory');
        await user.save();

        socket.emit('suluhanResult', { 
            success: true, 
            userData: user, 
            message: `🏛️ Suluhan Çarşısı'ndan [${itemTemplate.rarity}] ${itemTemplate.name} satın alındı!` 
        });
    });

    socket.on('getArenaOpponents', async () => {
        if (!checkRateLimit(socket.id)) return;

        const user = users[socket.id];
        if (!user) return;

        checkArenaReset(user);
        await user.save();

        try {
            // Her yenilemede rastgele 5 farklı rakip getir.
            // find().limit(5) sürekli aynı kayıtları döndürebildiği için $sample kullanıyoruz.
            const opponents = await User.aggregate([
                {
                    $match: {
                        _id: { $ne: user._id }
                    }
                },
                {
                    $sample: {
                        size: 5
                    }
                },
                {
                    $project: {
                        username: 1,
                        level: 1,
                        str: 1,
                        vit: 1,
                        equipped: 1,
                        honor: 1
                    }
                }
            ]);

            socket.emit('arenaOpponentsList', opponents);
        } catch (err) {
            console.error('Arena rakip yenileme hatası:', err);

            socket.emit('arenaResult', {
                success: false,
                userData: user,
                message: "Rakipler yüklenemedi."
            });
        }
    });

    socket.on('attackPlayer', async (data) => {
        if (!checkRateLimit(socket.id)) return;

        const attacker = users[socket.id];
        if (!attacker) return;

        checkArenaReset(attacker);

        if (attacker.arenaLimit <= 0) {
            return socket.emit('arenaResult', {
                success: false,
                userData: attacker,
                message: "Günlük 5 arena hakkın doldu!"
            });
        }

        try {
            const defenderId = data?.defenderId;

            if (!defenderId || String(defenderId) === String(attacker._id)) {
                return socket.emit('arenaResult', {
                    success: false,
                    userData: attacker,
                    message: "Geçersiz rakip seçimi!"
                });
            }

            const defender = await User.findById(defenderId);

            if (!defender) {
                return socket.emit('arenaResult', {
                    success: false,
                    userData: attacker,
                    message: "Rakip bulunamadı!"
                });
            }

            const getArenaStats = (u) => {
                const totalStr = getTotalStr(u);
                const totalVit = getTotalVit(u);

                return {
                    str: totalStr,
                    vit: totalVit,
                    maxHp: Math.max(100, totalVit * 20),
                    power: getCharacterCombatPower(u),
                    setPieces: getHukumdarSetEquippedCount(u)
                };
            };

            const attackerStats = getArenaStats(attacker);
            const defenderStats = getArenaStats(defender);

            let attackerHp = attackerStats.maxHp;
            let defenderHp = defenderStats.maxHp;

            const battleActions = [];

            const calculateArenaDamage = (sourceStats, targetStats) => {
                const variation = 0.85 + (Math.random() * 0.30);
                const baseDamage =
                    (sourceStats.str * 3.2) +
                    (sourceStats.power * 0.30);

                const mitigation = targetStats.vit * 0.55;

                let damage = Math.max(
                    5,
                    Math.floor((baseDamage * variation) - mitigation)
                );

                const critical = Math.random() < 0.15;

                if (critical) {
                    damage = Math.floor(damage * 1.75);
                }

                return {
                    damage: Math.max(1, damage),
                    critical
                };
            };

            const pushAttack = (
                round,
                actor,
                sourceStats,
                targetStats,
                targetCurrentHp,
                finisher = false
            ) => {
                const hit = calculateArenaDamage(sourceStats, targetStats);

                let damage = hit.damage;

                if (finisher) {
                    damage = Math.max(1, targetCurrentHp);
                } else {
                    damage = Math.min(damage, targetCurrentHp);
                }

                const targetHp = Math.max(0, targetCurrentHp - damage);

                battleActions.push({
                    round,
                    actor,
                    target: actor === 'attacker' ? 'defender' : 'attacker',
                    damage,
                    critical: finisher ? true : hit.critical,
                    finisher,
                    targetHp,
                    targetMaxHp: targetStats.maxHp
                });

                return targetHp;
            };

            // 3 ana tur: iki savaşçı da hayattaysa karşılıklı vuruşur.
            for (let round = 1; round <= 3; round++) {
                if (attackerHp <= 0 || defenderHp <= 0) break;

                defenderHp = pushAttack(
                    round,
                    'attacker',
                    attackerStats,
                    defenderStats,
                    defenderHp
                );

                if (defenderHp <= 0) break;

                attackerHp = pushAttack(
                    round,
                    'defender',
                    defenderStats,
                    attackerStats,
                    attackerHp
                );
            }

            let attackerWon;

            if (defenderHp <= 0) {
                attackerWon = true;
            } else if (attackerHp <= 0) {
                attackerWon = false;
            } else {
                // 3 tur sonunda kim daha güçlü durumda kaldıysa bitirici darbeyi vurur.
                const attackerHealthScore =
                    attackerHp / attackerStats.maxHp;

                const defenderHealthScore =
                    defenderHp / defenderStats.maxHp;

                const attackerJudgeScore =
                    (attackerHealthScore * 100) +
                    attackerStats.power +
                    (Math.random() * 10);

                const defenderJudgeScore =
                    (defenderHealthScore * 100) +
                    defenderStats.power +
                    (Math.random() * 10);

                attackerWon = attackerJudgeScore >= defenderJudgeScore;

                if (attackerWon) {
                    defenderHp = pushAttack(
                        4,
                        'attacker',
                        attackerStats,
                        defenderStats,
                        defenderHp,
                        true
                    );
                } else {
                    attackerHp = pushAttack(
                        4,
                        'defender',
                        defenderStats,
                        attackerStats,
                        attackerHp,
                        true
                    );
                }
            }

            // Arena hakkı gerçek savaş başladıktan sonra tüketilir.
            attacker.arenaLimit -= 1;

            let goldReward = 0;
            let honorChange = 0;
            let resultMessage = '';

            let honorRewardResult = {
                rubyReward: 0,
                milestonesGained: 0
            };

            if (attackerWon) {
                goldReward = Math.floor(Math.random() * 50) + 30;
                honorChange = 15;

                attacker.balance += goldReward;
                honorRewardResult = applyHonorChange(attacker, honorChange);
                attacker.arenaWins = (attacker.arenaWins || 0) + 1;

                const rubyMilestoneText = honorRewardResult.rubyReward > 0
                    ? ` 🎁 100 Onur eşiği! +${honorRewardResult.rubyReward} Yakut 💎 kazandın!`
                    : '';

                resultMessage =
                    `🏆 ZAFER! ${defender.username} mağlup edildi. ` +
                    `Ödül: +${goldReward} Altın 🪙 ve +${honorChange} Onur 🌟!` +
                    rubyMilestoneText;
            } else {
                honorChange = -5;
                applyHonorChange(attacker, honorChange);

                resultMessage =
                    `💀 MAĞLUBİYET! ${defender.username} arena savaşını kazandı. ` +
                    `5 Onur kaybettin.`;
            }

            recordAdventureProgress(
                attacker,
                'arena_battle',
                1,
                attackerWon ? 4 : 1
            );

            if (attackerWon) {
                recordAdventureProgress(
                    attacker,
                    'arena_win',
                    1,
                    4
                );
            }

            await attacker.save();

            socket.emit('arenaResult', {
                success: attackerWon,
                battleCompleted: true,
                userData: attacker,
                message: resultMessage,
                battle: {
                    attackerWon,
                    goldReward,
                    honorChange,
                    honorRubyReward: honorRewardResult.rubyReward || 0,
                    attacker: {
                        id: String(attacker._id),
                        username: attacker.username,
                        level: Math.min(MAX_LEVEL, Number(attacker.level) || 1),
                        title: getTitleByLevel(attacker.level),
                        honor: attacker.honor || 0,
                        str: attackerStats.str,
                        vit: attackerStats.vit,
                        power: attackerStats.power,
                        maxHp: attackerStats.maxHp
                    },
                    defender: {
                        id: String(defender._id),
                        username: defender.username,
                        level: Math.min(MAX_LEVEL, Number(defender.level) || 1),
                        title: getTitleByLevel(defender.level),
                        honor: defender.honor || 0,
                        str: defenderStats.str,
                        vit: defenderStats.vit,
                        power: defenderStats.power,
                        maxHp: defenderStats.maxHp
                    },
                    actions: battleActions
                }
            });
        } catch (err) {
            console.error('Arena savaş hatası:', err);

            socket.emit('arenaResult', {
                success: false,
                userData: attacker,
                message: "Savaş sırasında bir hata oluştu."
            });
        }
    });

    socket.on('usePotion', async () => {
        if (!checkRateLimit(socket.id)) return;
        const user = users[socket.id];

        if (!user || user.balance < 25000) {
            return socket.emit('marketResult', {
                success: false,
                userData: user,
                message: "Yetersiz altın! Can İksiri için 25.000 Altın gerekiyor."
            });
        }

        const maxHp = calculateMaxHpForProgression(user);
        user.balance -= 25000;
        user.hp = maxHp;

        await user.save();

        socket.emit('marketResult', {
            success: true,
            userData: user,
            message: `Can İksiri içildi! HP tamamen doldu: ${user.hp}/${maxHp} ❤️`
        });
    });

    socket.on('refillSefer', async () => {
        if (!checkRateLimit(socket.id)) return;
        const user = users[socket.id];
        if (!user || user.balance < 25000) return socket.emit('marketResult', { success: false, userData: user, message: "Yetersiz altın! Sefer İksiri için 25.000 Altın gerekiyor." });
        user.balance -= 25000; user.seferLimiti = MAX_SEFER_LIMITI; user.seferNextRefill = null;
        await user.save();
        socket.emit('marketResult', { success: true, userData: user, message: "Sefer limitin tamamen yenilendi! 20/20 🧭" });
    });

    socket.on('buyArmyRations', async () => {
        if (!checkRateLimit(socket.id)) return;

        const user = users[socket.id];
        if (!user) return;

        normalizeSiegeMarketState(user);

        const cost = 15000;

        if (user.siegePreparations.armyRations) {
            return socket.emit('marketResult', {
                success: false,
                userData: user,
                message: "🍖 Ordu Erzağı zaten hazır. Bir sonraki kuşatmada otomatik kullanılacak."
            });
        }

        if ((user.balance || 0) < cost) {
            return socket.emit('marketResult', {
                success: false,
                userData: user,
                message: `🪙 Ordu Erzağı için ${cost.toLocaleString('tr-TR')} Altın gerekiyor.`
            });
        }

        user.balance -= cost;
        user.siegePreparations.armyRations = true;
        user.markModified('siegePreparations');

        await user.save();

        socket.emit('marketResult', {
            success: true,
            userData: user,
            message: "🍖 Ordu Erzağı hazırlandı! Bir sonraki Kale Kuşatmasında asker kaybın %10 azalacak."
        });
    });

    socket.on('buyWarDrum', async () => {
        if (!checkRateLimit(socket.id)) return;

        const user = users[socket.id];
        if (!user) return;

        normalizeSiegeMarketState(user);

        const cost = 25;

        if (user.siegePreparations.warDrum) {
            return socket.emit('marketResult', {
                success: false,
                userData: user,
                message: "🥁 Savaş Davulu zaten hazır. Bir sonraki kuşatmada otomatik kullanılacak."
            });
        }

        if ((user.rubies || 0) < cost) {
            return socket.emit('marketResult', {
                success: false,
                userData: user,
                message: `💎 Savaş Davulu için ${cost} Yakut gerekiyor.`
            });
        }

        user.rubies -= cost;
        user.siegePreparations.warDrum = true;
        user.markModified('siegePreparations');

        await user.save();

        socket.emit('marketResult', {
            success: true,
            userData: user,
            message: "🥁 Savaş Davulu hazır! Bir sonraki Kale Kuşatmasında toplam saldırı gücün %5 artacak."
        });
    });

    socket.on('buyCommanderEdict', async () => {
        if (!checkRateLimit(socket.id)) return;

        const user = users[socket.id];
        if (!user) return;

        normalizeSiegeMarketState(user);

        const cost = 50;

        if (user.siegePreparations.commanderEdict) {
            return socket.emit('marketResult', {
                success: false,
                userData: user,
                message: "📜 Komutan Fermanı zaten hazır. Bir sonraki kuşatmada otomatik kullanılacak."
            });
        }

        if ((user.rubies || 0) < cost) {
            return socket.emit('marketResult', {
                success: false,
                userData: user,
                message: `💎 Komutan Fermanı için ${cost} Yakut gerekiyor.`
            });
        }

        user.rubies -= cost;
        user.siegePreparations.commanderEdict = true;
        user.markModified('siegePreparations');

        await user.save();

        socket.emit('marketResult', {
            success: true,
            userData: user,
            message: "📜 Komutan Fermanı hazır! Bir sonraki Kale Kuşatmasında karakter STR katkın %25 artacak."
        });
    });

    socket.on('useArmyDoctor', async () => {
        if (!checkRateLimit(socket.id)) return;

        const user = users[socket.id];
        if (!user) return;

        normalizeArmy(user);
        normalizeSiegeMarketState(user);

        const cost = 40000;
        const losses = user.lastCastleLosses || {};

        const totalLosses =
            (Number(losses.archer) || 0) +
            (Number(losses.warrior) || 0) +
            (Number(losses.cavalry) || 0) +
            (Number(losses.catapult) || 0);

        if (!losses.available || totalLosses <= 0) {
            return socket.emit('marketResult', {
                success: false,
                userData: user,
                message: "🩹 Tedavi edilecek son kuşatma kaybın bulunmuyor."
            });
        }

        if ((user.balance || 0) < cost) {
            return socket.emit('marketResult', {
                success: false,
                userData: user,
                message: `🪙 Ordu Hekimi için ${cost.toLocaleString('tr-TR')} Altın gerekiyor.`
            });
        }

        const restored = {
            archer: Math.ceil((Number(losses.archer) || 0) * 0.10),
            warrior: Math.ceil((Number(losses.warrior) || 0) * 0.10),
            cavalry: Math.ceil((Number(losses.cavalry) || 0) * 0.10),
            catapult: Math.ceil((Number(losses.catapult) || 0) * 0.10)
        };

        user.balance -= cost;

        user.army.archer += restored.archer;
        user.army.warrior += restored.warrior;
        user.army.cavalry += restored.cavalry;
        user.army.catapult += restored.catapult;

        user.lastCastleLosses = {
            archer: 0,
            warrior: 0,
            cavalry: 0,
            catapult: 0,
            available: false
        };

        user.markModified('army');
        user.markModified('lastCastleLosses');

        await user.save();

        socket.emit('marketResult', {
            success: true,
            userData: user,
            message:
                `🩹 Ordu Hekimi yaralı askerleri geri döndürdü! ` +
                `🏹 +${restored.archer} Okçu | ` +
                `⚔️ +${restored.warrior} Savaşçı | ` +
                `🐎 +${restored.cavalry} Süvari | ` +
                `🏗️ +${restored.catapult} Mancınık.`
        });
    });

    socket.on('depositBankGold', async (data) => {
        if (!checkRateLimit(socket.id)) return;

        const user = users[socket.id];
        if (!user) return;

        normalizeBankState(user);

        const amount = Number.parseInt(data?.amount, 10);

        if (!Number.isInteger(amount) || amount <= 0) {
            return socket.emit('marketResult', {
                success: false,
                userData: user,
                message: "🏦 Banka: Yatırılacak Altın miktarı geçersiz."
            });
        }

        if (amount > BANK_MAX_DEPOSIT) {
            return socket.emit('marketResult', {
                success: false,
                userData: user,
                message:
                    `🏦 Banka: Tek vadeli hesapta en fazla ` +
                    `${BANK_MAX_DEPOSIT.toLocaleString('tr-TR')} Altın yatırabilirsin.`
            });
        }

        if ((user.bankDeposit.principal || 0) > 0) {
            return socket.emit('marketResult', {
                success: false,
                userData: user,
                message:
                    `🏦 Banka: Zaten aktif bir vadeli hesabın var. ` +
                    `Mevcut anapara: ${user.bankDeposit.principal.toLocaleString('tr-TR')} Altın.`
            });
        }

        if ((user.balance || 0) < amount) {
            return socket.emit('marketResult', {
                success: false,
                userData: user,
                message:
                    `🪙 Banka: ${amount.toLocaleString('tr-TR')} Altın yatırmak için yeterli bakiyen yok.`
            });
        }

        const now = Date.now();
        const maturesAt = now + BANK_TERM_MS;
        const expectedInterest = Math.floor(amount * BANK_INTEREST_RATE);
        const expectedPayout = amount + expectedInterest;

        user.balance -= amount;
        user.bankDeposit = {
            principal: amount,
            startedAt: now,
            maturesAt
        };
        user.markModified('bankDeposit');

        await user.save();

        socket.emit('marketResult', {
            success: true,
            userData: user,
            bankAction: {
                type: 'deposit',
                principal: amount,
                interest: expectedInterest,
                payout: expectedPayout,
                maturesAt
            },
            message:
                `🏦 Vadeli hesap açıldı! ` +
                `${amount.toLocaleString('tr-TR')} Altın yatırdın. ` +
                `24 saat sonunda %50 faiz ile ` +
                `${expectedPayout.toLocaleString('tr-TR')} Altın tahsil edebilirsin.`
        });
    });

    socket.on('collectBankInterest', async () => {
        if (!checkRateLimit(socket.id)) return;

        const user = users[socket.id];
        if (!user) return;

        normalizeBankState(user);

        const principal = Number(user.bankDeposit.principal) || 0;
        const maturesAt = Number(user.bankDeposit.maturesAt) || 0;

        if (principal <= 0 || !maturesAt) {
            return socket.emit('marketResult', {
                success: false,
                userData: user,
                message: "🏦 Banka: Aktif vadeli hesabın bulunmuyor."
            });
        }

        const now = Date.now();

        if (now < maturesAt) {
            const remainingMs = maturesAt - now;
            const remainingMinutes = Math.ceil(remainingMs / 60000);
            const hours = Math.floor(remainingMinutes / 60);
            const minutes = remainingMinutes % 60;

            return socket.emit('marketResult', {
                success: false,
                userData: user,
                message:
                    `⏳ Banka: Vade henüz dolmadı. ` +
                    `Yaklaşık ${hours} saat ${minutes} dakika kaldı.`
            });
        }

        const interest = Math.floor(principal * BANK_INTEREST_RATE);
        const payout = principal + interest;

        user.balance = (user.balance || 0) + payout;
        user.bankDeposit = {
            principal: 0,
            startedAt: 0,
            maturesAt: 0
        };
        user.markModified('bankDeposit');

        await user.save();

        socket.emit('marketResult', {
            success: true,
            userData: user,
            bankAction: {
                type: 'collect',
                principal,
                interest,
                payout
            },
            message:
                `💰 Vade tamamlandı! ` +
                `${principal.toLocaleString('tr-TR')} Altın anapara + ` +
                `${interest.toLocaleString('tr-TR')} Altın faiz = ` +
                `${payout.toLocaleString('tr-TR')} Altın hesabına eklendi.`
        });
    });

    socket.on('exchangeRubyForGold', async (data) => {
        if (!checkRateLimit(socket.id)) return;

        const user = users[socket.id];
        if (!user) return;

        const rubyAmount = Number.parseInt(data?.amount, 10);

        if (
            !Number.isInteger(rubyAmount) ||
            rubyAmount < 100 ||
            rubyAmount % 100 !== 0
        ) {
            return socket.emit('marketResult', {
                success: false,
                userData: user,
                message: "💎 Sarraf: Yakut bozdurma işlemi minimum 100 Yakut ve 100'ün katları şeklinde yapılır."
            });
        }

        const goldReward = rubyAmount * 100;

        if ((user.rubies || 0) < rubyAmount) {
            return socket.emit('marketResult', {
                success: false,
                userData: user,
                message:
                    `💎 Sarraf: ${rubyAmount.toLocaleString('tr-TR')} Yakut bozdurmak için yeterli Yakutun yok.`
            });
        }

        user.rubies -= rubyAmount;
        user.balance = (user.balance || 0) + goldReward;

        await user.save();

        socket.emit('marketResult', {
            success: true,
            userData: user,
            exchange: {
                direction: 'rubyToGold',
                rubyAmount,
                goldAmount: goldReward
            },
            message:
                `💰 Sarraf işlemi tamamlandı: ` +
                `-${rubyAmount.toLocaleString('tr-TR')} Yakut 💎 → ` +
                `+${goldReward.toLocaleString('tr-TR')} Altın 🪙`
        });
    });

    socket.on('exchangeGoldForRuby', async (data) => {
        if (!checkRateLimit(socket.id)) return;

        const user = users[socket.id];
        if (!user) return;

        const rubyAmount = Number.parseInt(data?.amount, 10);

        if (
            !Number.isInteger(rubyAmount) ||
            rubyAmount < 100 ||
            rubyAmount % 100 !== 0
        ) {
            return socket.emit('marketResult', {
                success: false,
                userData: user,
                message: "🪙 Sarraf: Yakut satın alma işlemi minimum 100 Yakut ve 100'ün katları şeklinde yapılır."
            });
        }

        const goldCost = rubyAmount * 1000;

        if ((user.balance || 0) < goldCost) {
            return socket.emit('marketResult', {
                success: false,
                userData: user,
                message:
                    `🪙 Sarraf: ${rubyAmount.toLocaleString('tr-TR')} Yakut almak için ` +
                    `${goldCost.toLocaleString('tr-TR')} Altın gerekiyor.`
            });
        }

        user.balance -= goldCost;
        user.rubies = (user.rubies || 0) + rubyAmount;

        await user.save();

        socket.emit('marketResult', {
            success: true,
            userData: user,
            exchange: {
                direction: 'goldToRuby',
                rubyAmount,
                goldAmount: goldCost
            },
            message:
                `💰 Sarraf işlemi tamamlandı: ` +
                `-${goldCost.toLocaleString('tr-TR')} Altın 🪙 → ` +
                `+${rubyAmount.toLocaleString('tr-TR')} Yakut 💎`
        });
    });

    socket.on('buyMysteryBox', async () => {
        if (!checkRateLimit(socket.id)) return;

        const user = users[socket.id];

        if (!user || user.balance < 10000) {
            return socket.emit('marketResult', {
                success: false,
                userData: user,
                message: "🎁 Hazine Sandığı için 10.000 Altın gerekiyor."
            });
        }

        user.balance -= 10000;

        const rewardRoll = Math.random();

        // %10 Yakut ödülü
        if (rewardRoll < 0.10) {
            const rubyReward = Math.floor(Math.random() * 11) + 5; // 5-15
            user.rubies = (user.rubies || 0) + rubyReward;

            await user.save();

            return socket.emit('marketResult', {
                success: true,
                userData: user,
                message: `💎 Hazine Sandığından ${rubyReward} Yakut çıktı!`
            });
        }

        // %20 Altın ödülü
        if (rewardRoll < 0.30) {
            const goldReward = Math.floor(Math.random() * 10001) + 5000; // 5k-15k
            user.balance += goldReward;

            await user.save();

            return socket.emit('marketResult', {
                success: true,
                userData: user,
                message: `🪙 Hazine Sandığından ${goldReward.toLocaleString('tr-TR')} Altın çıktı!`
            });
        }

        // %70 ekipman
        const randRarity = Math.random();

        let rarity = 'Sıradan';
        let statMultiplier = 1;
        let bonusLevel = Math.floor(Math.random() * 2);

        if (randRarity > 0.90) {
            rarity = 'Epik';
            statMultiplier = 3;
            bonusLevel = 2;
        } else if (randRarity > 0.60) {
            rarity = 'Nadir';
            statMultiplier = 2;
            bonusLevel = Math.floor(Math.random() * 2) + 1;
        }

        const baseItems = [
            { id: 'item_sword', name: 'Savaş Baltası', icon: '🪓', type: 'weapon', baseStr: 7, baseVit: 2 },
            { id: 'item_shield', name: 'Demir Kalkan', icon: '🛡', type: 'shield', baseStr: 2, baseVit: 6 },
            { id: 'item_ring', name: 'Kudret Yüzüğü', icon: '💍', type: 'ring', baseStr: 4, baseVit: 4 },
            { id: 'item_helmet', name: 'Çelik Miğfer', icon: '🪖', type: 'helmet', baseStr: 1, baseVit: 5 },
            { id: 'item_armor', name: 'Savaş Zırhı', icon: '🛡️', type: 'armor', baseStr: 3, baseVit: 7 },
            { id: 'item_boots', name: 'Demir Çizmeler', icon: '👢', type: 'boots', baseStr: 2, baseVit: 4 },
            { id: 'item_gloves', name: 'Deri Eldiven', icon: '🧤', type: 'gloves', baseStr: 3, baseVit: 3 },
            { id: 'item_necklace', name: 'Antik Kolye', icon: '📿', type: 'necklace', baseStr: 5, baseVit: 2 }
        ];

        const base =
            baseItems[Math.floor(Math.random() * baseItems.length)];

        const wonItem = {
            id: `${base.id}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
            name: base.name.replace(/\s*\+\d+$/, ''),
            icon: base.icon,
            type: base.type,
            level: bonusLevel,
            rarity,
            strBonus:
                (base.baseStr * statMultiplier) +
                (bonusLevel * 2),
            vitBonus:
                (base.baseVit * statMultiplier) +
                (bonusLevel * 2)
        };

        user.inventory.push(wonItem);
        user.markModified('inventory');

        await user.save();

        socket.emit('marketResult', {
            success: true,
            userData: user,
            message:
                `🎁 Hazine Sandığından [${rarity}] ` +
                `${wonItem.name} +${wonItem.level} çıktı!`
        });
    });

    socket.on('getTimarStatus', async () => {
        if (!checkRateLimit(socket.id)) return;
        const user = users[socket.id];
        if (!user) return;

        try {
            const status = await getTimarStatusForUser(user, true);
            await user.save();
            socket.emit('timarStatus', status);
        } catch (err) {
            console.error('Tımar durumu hatası:', err);
            socket.emit('timarResult', {
                success: false,
                userData: user,
                message: 'Tımar bilgileri yüklenemedi.'
            });
        }
    });

    socket.on('buyEstate', async (data) => {
        if (!checkRateLimit(socket.id)) return;
        const user = users[socket.id];
        if (!user) return;

        try {
            normalizeTimarState(user);
            const estateId = Number.parseInt(data?.estateId, 10);
            const definition = TIMAR_DEFINITIONS[estateId];

            if (!definition) {
                return socket.emit('timarResult', {
                    success: false,
                    userData: user,
                    message: 'Geçersiz Tımar seçimi.'
                });
            }

            if (user.estates.includes(estateId)) {
                return socket.emit('timarResult', {
                    success: false,
                    userData: user,
                    message: 'Bu Tımara zaten sahipsin.'
                });
            }

            if ((user.balance || 0) < definition.purchaseCost) {
                return socket.emit('timarResult', {
                    success: false,
                    userData: user,
                    message: `🪙 ${definition.name} için ${definition.purchaseCost.toLocaleString('tr-TR')} Altın gerekiyor.`
                });
            }

            user.balance -= definition.purchaseCost;
            user.estates.push(estateId);
            user.timarStates.push(createDefaultTimarState(estateId, user, Date.now()));
            user.markModified('estates');
            user.markModified('timarStates');
            await user.save();

            const status = await getTimarStatusForUser(user, false);
            socket.emit('timarResult', {
                success: true,
                userData: user,
                status,
                action: { type: 'purchase', estateId },
                message: `${definition.icon} ${definition.name} artık senin! Gelir doğrudan Tımar Hazinesinde birikecek.`
            });
        } catch (err) {
            console.error('Tımar satın alma hatası:', err);
            socket.emit('timarResult', {
                success: false,
                userData: user,
                message: 'Tımar satın alınamadı.'
            });
        }
    });

    socket.on('upgradeTimarEstate', async (data) => {
        if (!checkRateLimit(socket.id)) return;
        const user = users[socket.id];
        if (!user) return;

        try {
            const statusBefore = await getTimarStatusForUser(user, true);
            const estateId = Number.parseInt(data?.estateId, 10);
            const state = getTimarState(user, estateId);
            const definition = TIMAR_DEFINITIONS[estateId];

            if (!state || !definition) {
                return socket.emit('timarResult', {
                    success: false,
                    userData: user,
                    status: statusBefore,
                    message: 'Bu Tımara sahip değilsin.'
                });
            }

            if (Number(state.level) >= TIMAR_MAX_LEVEL) {
                return socket.emit('timarResult', {
                    success: false,
                    userData: user,
                    status: statusBefore,
                    message: `🏰 ${definition.name} zaten maksimum Seviye ${TIMAR_MAX_LEVEL}.`
                });
            }

            const cost = getTimarLevelUpgradeCost(state);
            if ((user.balance || 0) < cost) {
                return socket.emit('timarResult', {
                    success: false,
                    userData: user,
                    status: statusBefore,
                    message: `🪙 Tımar yükseltmesi için ${cost.toLocaleString('tr-TR')} Altın gerekiyor.`
                });
            }

            user.balance -= cost;
            state.level += 1;
            user.markModified('timarStates');
            await user.save();

            const status = await getTimarStatusForUser(user, false);
            socket.emit('timarResult', {
                success: true,
                userData: user,
                status,
                action: { type: 'upgrade', estateId },
                message: `🏰 ${definition.name} Seviye ${state.level} oldu! Gelir ve hazine kapasitesi arttı.`
            });
        } catch (err) {
            console.error('Tımar yükseltme hatası:', err);
            socket.emit('timarResult', { success: false, userData: user, message: 'Tımar yükseltilemedi.' });
        }
    });

    socket.on('setTimarTaxPolicy', async (data) => {
        if (!checkRateLimit(socket.id)) return;
        const user = users[socket.id];
        if (!user) return;

        try {
            await getTimarStatusForUser(user, true);
            const estateId = Number.parseInt(data?.estateId, 10);
            const policy = String(data?.policy || '');
            const state = getTimarState(user, estateId);
            const policyDef = TIMAR_TAX_POLICIES[policy];

            if (!state || !policyDef) {
                return socket.emit('timarResult', {
                    success: false,
                    userData: user,
                    message: 'Vergi politikası değiştirilemedi.'
                });
            }

            state.taxPolicy = policy;
            user.markModified('timarStates');
            await user.save();

            const status = await getTimarStatusForUser(user, false);
            socket.emit('timarResult', {
                success: true,
                userData: user,
                status,
                action: { type: 'tax', estateId },
                message: `📜 ${TIMAR_DEFINITIONS[estateId].name}: ${policyDef.name} uygulanmaya başladı.`
            });
        } catch (err) {
            console.error('Tımar vergi hatası:', err);
            socket.emit('timarResult', { success: false, userData: user, message: 'Vergi politikası değiştirilemedi.' });
        }
    });

    socket.on('upgradeTimarBuilding', async (data) => {
        if (!checkRateLimit(socket.id)) return;
        const user = users[socket.id];
        if (!user) return;

        try {
            await getTimarStatusForUser(user, true);
            const estateId = Number.parseInt(data?.estateId, 10);
            const buildingType = String(data?.buildingType || '');
            const state = getTimarState(user, estateId);
            const building = TIMAR_BUILDINGS[buildingType];

            if (!state || !building) {
                return socket.emit('timarResult', { success: false, userData: user, message: 'Bina geliştirilemedi.' });
            }

            const currentLevel = Number(state.buildings[buildingType]) || 0;
            if (currentLevel >= TIMAR_BUILDING_MAX_LEVEL) {
                return socket.emit('timarResult', {
                    success: false,
                    userData: user,
                    message: `${building.icon} ${building.name} zaten maksimum seviyede.`
                });
            }

            const cost = getTimarBuildingUpgradeCost(state, buildingType);
            if ((user.balance || 0) < cost) {
                return socket.emit('timarResult', {
                    success: false,
                    userData: user,
                    message: `🪙 ${building.name} geliştirmesi için ${cost.toLocaleString('tr-TR')} Altın gerekiyor.`
                });
            }

            user.balance -= cost;
            state.buildings[buildingType] = currentLevel + 1;
            user.markModified('timarStates');
            await user.save();

            const status = await getTimarStatusForUser(user, false);
            socket.emit('timarResult', {
                success: true,
                userData: user,
                status,
                action: { type: 'building', estateId, buildingType },
                message: `${building.icon} ${building.name} Seviye ${currentLevel + 1} oldu!`
            });
        } catch (err) {
            console.error('Tımar bina geliştirme hatası:', err);
            socket.emit('timarResult', { success: false, userData: user, message: 'Bina geliştirilemedi.' });
        }
    });

    socket.on('collectTimarTreasury', async (data) => {
        if (!checkRateLimit(socket.id)) return;
        const user = users[socket.id];
        if (!user) return;

        try {
            await getTimarStatusForUser(user, true);
            const estateId = data?.estateId !== undefined && data?.estateId !== null
                ? Number.parseInt(data.estateId, 10)
                : null;

            let collected = 0;
            const collectedEstates = [];

            for (const ownedEstateId of user.estates) {
                if (estateId !== null && Number(ownedEstateId) !== estateId) continue;
                const state = getTimarState(user, ownedEstateId);
                if (!state) continue;

                const amount = Math.max(0, Math.floor(Number(state.treasury) || 0));
                if (amount <= 0) continue;

                collected += amount;
                collectedEstates.push({ estateId: Number(ownedEstateId), amount });
                state.treasury = 0;
            }

            if (collected <= 0) {
                const status = await getTimarStatusForUser(user, false);
                return socket.emit('timarResult', {
                    success: false,
                    userData: user,
                    status,
                    message: '📦 Tımar hazinelerinde toplanacak Altın yok.'
                });
            }

            user.balance = (user.balance || 0) + collected;
            user.markModified('timarStates');
            await user.save();

            const status = await getTimarStatusForUser(user, false);
            socket.emit('timarResult', {
                success: true,
                userData: user,
                status,
                action: { type: 'collect', amount: collected, estates: collectedEstates },
                message: `💰 Tımar vergileri toplandı: +${collected.toLocaleString('tr-TR')} Altın!`
            });
        } catch (err) {
            console.error('Tımar vergi toplama hatası:', err);
            socket.emit('timarResult', { success: false, userData: user, message: 'Vergiler toplanamadı.' });
        }
    });

    socket.on('resolveTimarEvent', async (data) => {
        if (!checkRateLimit(socket.id)) return;
        const user = users[socket.id];
        if (!user) return;

        try {
            await getTimarStatusForUser(user, true);
            checkSeferRefill(user);

            const estateId = Number.parseInt(data?.estateId, 10);
            const state = getTimarState(user, estateId);

            if (!state || !state.event?.active) {
                return socket.emit('timarResult', {
                    success: false,
                    userData: user,
                    message: 'Bu Tımarda çözülmesi gereken aktif bir olay yok.'
                });
            }

            if ((user.seferLimiti || 0) <= 0) {
                return socket.emit('timarResult', {
                    success: false,
                    userData: user,
                    message: '🧭 Olayı bastırmak için 1 Sefer Hakkı gerekiyor.'
                });
            }

            user.seferLimiti -= 1;
            if (user.seferLimiti < MAX_SEFER_LIMITI && !user.seferNextRefill) {
                user.seferNextRefill = Date.now() + REFILL_INTERVAL;
            }

            const reward = 250 + (estateId * 150) + ((Number(state.level) || 1) * 100);
            user.balance = (user.balance || 0) + reward;
            state.loyalty = Math.min(100, (Number(state.loyalty) || 0) + 8);

            const eventName = state.event.name || 'Tımar Olayı';
            state.event = { active: false, type: '', name: '', penaltyPercent: 0, createdAt: 0 };
            user.markModified('timarStates');

            recordAdventureProgress(
                user,
                'timar_event',
                1,
                4
            );

            await user.save();

            const status = await getTimarStatusForUser(user, false);
            socket.emit('timarResult', {
                success: true,
                userData: user,
                status,
                action: { type: 'event', estateId },
                message: `⚔️ ${eventName} bastırıldı! 👥 Sadakat +8 | 🪙 +${reward.toLocaleString('tr-TR')} Altın | 🧭 -1 Sefer.`
            });
        } catch (err) {
            console.error('Tımar olay çözme hatası:', err);
            socket.emit('timarResult', { success: false, userData: user, message: 'Tımar olayı çözülemedi.' });
        }
    });

    socket.on('upgradeItem', async (data) => {
        if (!checkRateLimit(socket.id)) return;

        const user = users[socket.id];
        const itemIndex = Number.parseInt(data?.itemIndex, 10);

        if (
            !user ||
            !Number.isInteger(itemIndex) ||
            itemIndex < 0 ||
            !user.inventory[itemIndex]
        ) {
            return;
        }

        normalizeBlacksmithState(user);

        const item = user.inventory[itemIndex];

        if (!EQUIP_SLOTS.includes(item.type)) {
            return socket.emit('forgeResult', {
                success: false,
                userData: user,
                message: "Bu malzeme Demirhane'de geliştirilemez."
            });
        }

        const currentLvl = Number(item.level) || 0;
        const nextLvl = currentLvl + 1;
        const baseGoldCost = nextLvl * 150;
        const masteryDiscount = getBlacksmithDiscount(user.blacksmithMastery.level);
        const goldCost = Math.max(1, Math.ceil(baseGoldCost * (1 - masteryDiscount)));
        const rubyCost = nextLvl;

        if (user.balance < goldCost || (user.rubies || 0) < rubyCost) {
            return socket.emit('forgeResult', {
                success: false,
                userData: user,
                message: `Yetersiz Altın veya Yakut! Gerekli: ${goldCost} Altın 🪙 ve ${rubyCost} Yakut 💎`
            });
        }

        const isBlessingMilestone = nextLvl % 10 === 0;

        if (isBlessingMilestone) {
            const blessingCount = Number.parseInt(data?.blessingCount, 10);

            if (!Number.isInteger(blessingCount) || blessingCount < 1 || blessingCount > 4) {
                return socket.emit('forgeResult', {
                    success: false,
                    userData: user,
                    message: `📜 +${nextLvl} için 1 ile 4 arasında Kutsama Kağıdı seçmelisin.`
                });
            }

            const blessingPaperIndices = [];

            user.inventory.forEach((invItem, index) => {
                if (
                    invItem &&
                    (
                        invItem.baseId === 'blessing_scroll' ||
                        (invItem.type === 'material' && invItem.name === 'Kutsama Kağıdı')
                    )
                ) {
                    blessingPaperIndices.push(index);
                }
            });

            if (blessingPaperIndices.length < blessingCount) {
                return socket.emit('forgeResult', {
                    success: false,
                    userData: user,
                    message:
                        `📜 Yeterli Kutsama Kağıdın yok! ` +
                        `Seçilen: ${blessingCount}, Envanterde: ${blessingPaperIndices.length}.`
                });
            }

            user.balance -= goldCost;
            user.rubies -= rubyCost;

            let remainingToRemove = blessingCount;
            user.inventory = user.inventory.filter(invItem => {
                if (
                    remainingToRemove > 0 &&
                    invItem &&
                    (
                        invItem.baseId === 'blessing_scroll' ||
                        (invItem.type === 'material' && invItem.name === 'Kutsama Kağıdı')
                    )
                ) {
                    remainingToRemove -= 1;
                    return false;
                }
                return true;
            });

            const successChance = blessingCount * 25;
            const roll = Math.random() * 100;
            const blessingSuccess = blessingCount >= 4 || roll < successChance;

            if (!blessingSuccess) {
                const mastery = grantBlacksmithMasteryXp(user, 5);
                user.markModified('inventory');
                await user.save();

                return socket.emit('forgeResult', {
                    success: false,
                    blessingAttempt: true,
                    forgeAction: {
                        type: 'blessingFail',
                        itemName: (item.name || 'Eşya').replace(/\s*\+\d+$/, ''),
                        level: currentLvl
                    },
                    userData: user,
                    message:
                        `❌ Kutsama başarısız! +${nextLvl} geçmedi. ` +
                        `📜 ${blessingCount} Kutsama Kağıdı kullanıldı (%${successChance} şans). ` +
                        `Eşyan yanmadı ve +${currentLvl} seviyesinde kaldı. ` +
                        `🔨 +${mastery.gained} Ustalık XP.`
                });
            }

            item.name = (item.name || 'Eşya').replace(/\s*\+\d+$/, '');
            item.level = nextLvl;

            const statBoost = item.rarity === 'Efsanevi'
                ? 5
                : (item.rarity === 'Epik'
                    ? 4
                    : (item.rarity === 'Nadir' ? 3 : 2));

            item.strBonus = (item.strBonus || 0) + statBoost;
            item.vitBonus = (item.vitBonus || 0) + statBoost;

            const mastery = grantBlacksmithMasteryXp(user, 10);
            user.markModified('inventory');
            await user.save();

            return socket.emit('forgeResult', {
                success: true,
                blessingAttempt: true,
                forgeAction: {
                    type: 'upgradeSuccess',
                    blessing: true,
                    itemName: item.name,
                    level: nextLvl
                },
                userData: user,
                message:
                    `✨ Kutsama başarılı! Eşya +${nextLvl} seviyesine geçti. ` +
                    `📜 ${blessingCount} Kutsama Kağıdı kullanıldı (%${successChance} şans). ` +
                    `${goldCost} Altın 🪙 ve ${rubyCost} Yakut 💎 harcandı. ` +
                    `🔨 +${mastery.gained} Ustalık XP.` +
                    (mastery.levelsGained > 0 ? ` Ustalık Seviyesi ${mastery.level}!` : '')
            });
        }

        user.balance -= goldCost;
        user.rubies -= rubyCost;

        item.name = (item.name || 'Eşya').replace(/\s*\+\d+$/, '');
        item.level = nextLvl;

        const statBoost = item.rarity === 'Efsanevi'
                ? 5
                : (item.rarity === 'Epik'
                    ? 4
                    : (item.rarity === 'Nadir' ? 3 : 2));

        item.strBonus = (item.strBonus || 0) + statBoost;
        item.vitBonus = (item.vitBonus || 0) + statBoost;

        const mastery = grantBlacksmithMasteryXp(user, 10);
        user.markModified('inventory');
        await user.save();

        socket.emit('forgeResult', {
            success: true,
            forgeAction: {
                type: 'upgradeSuccess',
                blessing: false,
                itemName: item.name,
                level: nextLvl
            },
            userData: user,
            message:
                `Eşya +${item.level} seviyesine geliştirildi! ` +
                `(${goldCost} Altın, ${rubyCost} Yakut harcandı) ` +
                `🔨 +${mastery.gained} Ustalık XP.` +
                (mastery.levelsGained > 0 ? ` Ustalık Seviyesi ${mastery.level}!` : '')
        });
    });

    socket.on('smeltItem', async (data) => {
        if (!checkRateLimit(socket.id)) return;

        const user = users[socket.id];
        const itemIndex = Number.parseInt(data?.itemIndex, 10);

        if (
            !user ||
            !Number.isInteger(itemIndex) ||
            itemIndex < 0 ||
            !user.inventory[itemIndex]
        ) {
            return;
        }

        normalizeBlacksmithState(user);

        const item = user.inventory[itemIndex];

        if (!EQUIP_SLOTS.includes(item.type)) {
            return socket.emit('forgeResult', {
                success: false,
                userData: user,
                message: '🔥 Sadece ekipmanlar eritilebilir.'
            });
        }

        const oreYield = getSmeltOreYield(item);
        const cleanName = (item.name || 'Eşya').replace(/\s*\+\d+$/, '');
        const level = Number(item.level) || 0;
        const rarity = item.rarity || 'Sıradan';

        user.inventory.splice(itemIndex, 1);
        user.blacksmithMastery.ironOre += oreYield;

        const mastery = grantBlacksmithMasteryXp(user, 5);

        user.markModified('inventory');
        user.markModified('blacksmithMastery');
        await user.save();

        socket.emit('forgeResult', {
            success: true,
            forgeAction: {
                type: 'smelt',
                itemName: cleanName,
                itemLevel: level,
                rarity,
                oreYield
            },
            userData: user,
            message:
                `🔥 [${rarity}] ${cleanName} +${level} eritildi. ` +
                `⛏️ +${oreYield} Demir Cevheri kazandın. ` +
                `🔨 +${mastery.gained} Ustalık XP.` +
                (mastery.levelsGained > 0 ? ` Ustalık Seviyesi ${mastery.level}!` : '')
        });
    });

    socket.on('reforgeItem', async (data) => {
        if (!checkRateLimit(socket.id)) return;

        const user = users[socket.id];
        const itemIndex = Number.parseInt(data?.itemIndex, 10);

        if (
            !user ||
            !Number.isInteger(itemIndex) ||
            itemIndex < 0 ||
            !user.inventory[itemIndex]
        ) {
            return;
        }

        normalizeBlacksmithState(user);

        const item = user.inventory[itemIndex];

        if (!EQUIP_SLOTS.includes(item.type)) {
            return socket.emit('forgeResult', {
                success: false,
                userData: user,
                message: '🔨 Sadece ekipmanlar yeniden dövülebilir.'
            });
        }

        const totalStats = Math.max(0, (Number(item.strBonus) || 0) + (Number(item.vitBonus) || 0));

        if (totalStats < 2) {
            return socket.emit('forgeResult', {
                success: false,
                userData: user,
                message: '🔨 Bu eşyanın yeniden dağıtılabilecek yeterli STR/VIT puanı yok.'
            });
        }

        const level = Math.max(0, Number(item.level) || 0);
        const oreCost = 5 + Math.floor(level / 5);
        const baseGoldCost = 500 + (level * 100);
        const masteryDiscount = getBlacksmithDiscount(user.blacksmithMastery.level);
        const goldCost = Math.max(1, Math.ceil(baseGoldCost * (1 - masteryDiscount)));

        if ((user.blacksmithMastery.ironOre || 0) < oreCost) {
            return socket.emit('forgeResult', {
                success: false,
                userData: user,
                message: `⛏️ Yeniden Dövme için ${oreCost} Demir Cevheri gerekiyor.`
            });
        }

        if ((user.balance || 0) < goldCost) {
            return socket.emit('forgeResult', {
                success: false,
                userData: user,
                message: `🪙 Yeniden Dövme için ${goldCost.toLocaleString('tr-TR')} Altın gerekiyor.`
            });
        }

        const oldStr = Number(item.strBonus) || 0;
        const oldVit = Number(item.vitBonus) || 0;

        let newStr = oldStr;
        let newVit = oldVit;

        for (let attempt = 0; attempt < 8; attempt++) {
            const minStr = Math.max(1, Math.floor(totalStats * 0.25));
            const maxStr = Math.min(totalStats - 1, Math.ceil(totalStats * 0.75));
            const span = Math.max(1, maxStr - minStr + 1);

            newStr = minStr + Math.floor(Math.random() * span);
            newVit = totalStats - newStr;

            if (newStr !== oldStr || newVit !== oldVit) break;
        }

        user.blacksmithMastery.ironOre -= oreCost;
        user.balance -= goldCost;

        item.strBonus = newStr;
        item.vitBonus = newVit;

        const mastery = grantBlacksmithMasteryXp(user, 12);

        user.markModified('inventory');
        user.markModified('blacksmithMastery');
        await user.save();

        socket.emit('forgeResult', {
            success: true,
            forgeAction: {
                type: 'reforge',
                itemName: (item.name || 'Eşya').replace(/\s*\+\d+$/, ''),
                oldStr,
                oldVit,
                newStr,
                newVit,
                oreCost,
                goldCost
            },
            userData: user,
            message:
                `🔨 Yeniden Dövme tamamlandı! ` +
                `STR ${oldStr} → ${newStr} | VIT ${oldVit} → ${newVit}. ` +
                `⛏️ ${oreCost} Cevher ve 🪙 ${goldCost.toLocaleString('tr-TR')} Altın harcandı. ` +
                `🔨 +${mastery.gained} Ustalık XP.` +
                (mastery.levelsGained > 0 ? ` Ustalık Seviyesi ${mastery.level}!` : '')
        });
    });

    socket.on('equipItem', async (data) => {
        const user = users[socket.id];
        if (!user || !user.inventory[data.itemIndex]) return;

        const candidateItem = user.inventory[data.itemIndex];
        if (!EQUIP_SLOTS.includes(candidateItem.type)) {
            return socket.emit('statUpdated', user);
        }

        const calculateMaxHp = (u) => calculateMaxHpForProgression(u);

        // Ekipman değişmeden önce sağlık yüzdesini sakla.
        const oldMaxHp = calculateMaxHp(user);
        const hpRatio = oldMaxHp > 0
            ? Math.max(0, Math.min(1, (Number(user.hp) || 0) / oldMaxHp))
            : 1;

        const item = user.inventory[data.itemIndex];
        item.name = (item.name || 'Eşya').replace(/\s*\+\d+$/, '');

        const old = user.equipped[item.type];
        if (old) old.name = (old.name || 'Eşya').replace(/\s*\+\d+$/, '');

        user.inventory.splice(data.itemIndex, 1);
        if (old) user.inventory.push(old);
        user.equipped[item.type] = item;

        // Yeni maksimum HP'ye aynı sağlık yüzdesiyle geç.
        // 100/100 -> +VIT ekipman -> 200/200
        // 50/100  -> +VIT ekipman -> 100/200
        const newMaxHp = calculateMaxHp(user);
        user.hp = Math.round(newMaxHp * hpRatio);

        user.markModified('equipped');
        user.markModified('inventory');
        await user.save();

        socket.emit('statUpdated', user);
    });

    socket.on('unequipItem', async (data) => {
        const user = users[socket.id];
        if (!user || !user.equipped[data.slot]) return;

        const calculateMaxHp = (u) => calculateMaxHpForProgression(u);

        // Ekipman çıkmadan önce sağlık yüzdesini sakla.
        const oldMaxHp = calculateMaxHp(user);
        const hpRatio = oldMaxHp > 0
            ? Math.max(0, Math.min(1, (Number(user.hp) || 0) / oldMaxHp))
            : 1;

        const item = user.equipped[data.slot];
        item.name = (item.name || 'Eşya').replace(/\s*\+\d+$/, '');

        user.inventory.push(item);
        user.equipped[data.slot] = null;

        const newMaxHp = calculateMaxHp(user);
        user.hp = Math.round(newMaxHp * hpRatio);

        user.markModified('equipped');
        user.markModified('inventory');
        await user.save();

        socket.emit('statUpdated', user);
    });

    socket.on('deleteItem', async (data) => {
        const user = users[socket.id];
        if (!user || data.itemIndex === undefined) return;
        user.inventory.splice(data.itemIndex, 1);
        user.markModified('inventory');
        await user.save();
        socket.emit('statUpdated', user);
    });

    // ============================================================
    // KLAN SİSTEMİ V1 — AKTİF
    // ============================================================

    socket.on('getClanData', async () => {
        const user = users[socket.id];

        if (!user) {
            return socket.emit('clanData', {
                clan: null,
                userData: null,
                error: 'Oturum bulunamadı. Lütfen yeniden giriş yap.'
            });
        }

        try {
            await sendClanData(socket, user);
        } catch (err) {
            console.error('getClanData hatası:', err);

            // Hata durumunda da istemciye clanData gönder.
            // Böylece Klan ekranı "yükleniyor" durumunda sonsuza kadar kalmaz.
            socket.emit('clanData', {
                clan: null,
                userData: user,
                error: 'Klan bilgileri yüklenirken sunucu hatası oluştu.'
            });
        }
    });

    socket.on('getClanList', async () => {
        const user = users[socket.id];
        if (!user) return;

        try {
            const clans = await Clan.find({})
                .select('name tag level treasury members maxMembers wins losses')
                .sort({ level: -1, treasury: -1, createdAt: 1 })
                .limit(50)
                .lean();

            socket.emit('clanList', clans.map(clan => {
                const levelState = getClanLevelState(clan);
                return {
                    _id: String(clan._id),
                    name: clan.name,
                    tag: clan.tag,
                    level: levelState.level,
                    rankTitle: levelState.title,
                    treasury: Math.max(0, Number(clan.treasury) || 0),
                    memberCount: Array.isArray(clan.members) ? clan.members.length : 0,
                    maxMembers: levelState.maxMembers,
                    wins: Math.max(0, Number(clan.wins) || 0),
                    losses: Math.max(0, Number(clan.losses) || 0)
                };
            }));
        } catch (err) {
            console.error('getClanList hatası:', err);

            // Liste hatası ana klan ekranını kilitlemesin.
            socket.emit('clanList', []);
            socket.emit('clanListError', {
                message: 'Klan listesi yüklenemedi.'
            });
        }
    });

    socket.on('getClanCastleWarStatus', async () => {
        const user = users[socket.id];
        if (!user) return;

        try {
            socket.emit(
                'clanCastleWarStatus',
                await buildClanCastleWarStatus(user)
            );
        } catch (err) {
            console.error(
                'getClanCastleWarStatus hatası:',
                err
            );

            socket.emit('clanCastleWarResult', {
                success: false,
                message:
                    'Klan Kale Savaşı bilgileri yüklenemedi.'
            });
        }
    });

    socket.on('attackClanCastleWar', async () => {
        if (!checkRateLimit(socket.id)) return;

        const user = users[socket.id];
        if (!user) return;

        if (!user.clanId) {
            return socket.emit('clanCastleWarResult', {
                success: false,
                userData: user,
                status: await buildClanCastleWarStatus(user),
                message:
                    '🏰 Kale Savaşına katılmak için bir klana üye olmalısın.'
            });
        }

        try {
            const now = Date.now();
            const windowInfo =
                getClanCastleWarWindow(now);

            if (!windowInfo.active) {
                return socket.emit(
                    'clanCastleWarResult',
                    {
                        success: false,
                        userData: user,
                        status:
                            await buildClanCastleWarStatus(user),
                        message:
                            '⏳ Klan Kale Savaşı şu anda kapalı. Bir sonraki savaş saatini beklemelisin.'
                    }
                );
            }

            const clan =
                await Clan.findById(user.clanId);

            if (!clan) {
                user.clanId = null;
                user.clanRole = null;
                await user.save();

                return socket.emit(
                    'clanCastleWarResult',
                    {
                        success: false,
                        userData: user,
                        status:
                            await buildClanCastleWarStatus(user),
                        message:
                            'Klan kaydın bulunamadı.'
                    }
                );
            }

            const membership =
                (clan.members || []).find(
                    member =>
                        String(member.userId) ===
                        String(user._id)
                );

            if (!membership) {
                return socket.emit(
                    'clanCastleWarResult',
                    {
                        success: false,
                        userData: user,
                        status:
                            await buildClanCastleWarStatus(user),
                        message:
                            'Klan üyeliğin doğrulanamadı.'
                    }
                );
            }

            normalizeArmy(user);

            const war =
                await ensureClanCastleWar(
                    windowInfo
                );

            let clanEntry =
                (war.entries || []).find(
                    entry =>
                        String(entry.clanId) ===
                        String(clan._id)
                );

            if (!clanEntry) {
                war.entries.push({
                    clanId: clan._id,
                    clanName: clan.name,
                    clanTag: clan.tag,
                    totalDamage: 0,
                    attackCount: 0,
                    firstDamageAt: 0,
                    lastDamageAt: 0,
                    members: []
                });

                clanEntry =
                    war.entries[
                        war.entries.length - 1
                    ];
            }

            let memberEntry =
                (clanEntry.members || []).find(
                    member =>
                        String(member.userId) ===
                        String(user._id)
                );

            if (!memberEntry) {
                clanEntry.members.push({
                    userId: user._id,
                    username: user.username,
                    damage: 0,
                    attacks: 0,
                    lastAttackAt: 0
                });

                memberEntry =
                    clanEntry.members[
                        clanEntry.members.length - 1
                    ];
            }

            const attacksUsed =
                Math.max(
                    0,
                    Number(memberEntry.attacks) || 0
                );

            if (
                attacksUsed >=
                CLAN_CASTLE_WAR_ATTACK_LIMIT
            ) {
                return socket.emit(
                    'clanCastleWarResult',
                    {
                        success: false,
                        userData: user,
                        status:
                            await buildClanCastleWarStatus(user),
                        message:
                            `⛔ Bu savaş için ${CLAN_CASTLE_WAR_ATTACK_LIMIT} saldırı hakkını kullandın.`
                    }
                );
            }

            const lastAttackAt =
                Math.max(
                    0,
                    Number(memberEntry.lastAttackAt) || 0
                );

            const cooldownRemaining =
                Math.max(
                    0,
                    CLAN_CASTLE_WAR_ATTACK_COOLDOWN_MS -
                    (now - lastAttackAt)
                );

            if (cooldownRemaining > 0) {
                return socket.emit(
                    'clanCastleWarResult',
                    {
                        success: false,
                        userData: user,
                        status:
                            await buildClanCastleWarStatus(user),
                        message:
                            `⏳ Yeni saldırı için ${Math.ceil(cooldownRemaining / 1000)} saniye beklemelisin.`
                    }
                );
            }

            const characterPower =
                getCharacterCombatPower(user);

            const armyPower =
                getArmyPower(user.army);

            const setBonus =
                getHukumdarSetBonusState(user);

            const siegeBonusMultiplier =
                1 +
                (
                    (
                        Number(
                            setBonus.castleAttackPercent
                        ) || 0
                    ) / 100
                );

            const clanLevelState = getClanLevelState(clan);
            const clanDamageMultiplier =
                1 + (clanLevelState.castleDamageBonusPercent / 100);

            const randomMultiplier =
                0.90 +
                (Math.random() * 0.20);

            const totalAttackPower =
                Math.max(
                    1,
                    characterPower +
                    armyPower
                );

            const damage =
                Math.max(
                    1,
                    Math.floor(
                        totalAttackPower *
                        siegeBonusMultiplier *
                        clanDamageMultiplier *
                        randomMultiplier
                    )
                );

            clanEntry.totalDamage =
                (Number(clanEntry.totalDamage) || 0) +
                damage;

            clanEntry.attackCount =
                (Number(clanEntry.attackCount) || 0) +
                1;

            if (!clanEntry.firstDamageAt) {
                clanEntry.firstDamageAt = now;
            }

            clanEntry.lastDamageAt = now;

            memberEntry.damage =
                (Number(memberEntry.damage) || 0) +
                damage;

            memberEntry.attacks =
                attacksUsed + 1;

            memberEntry.lastAttackAt = now;

            recordAdventureProgress(
                user,
                'clan_war_attack',
                1,
                8
            );

            war.markModified('entries');
            await Promise.all([
                war.save(),
                user.save()
            ]);

            const status =
                await buildClanCastleWarStatus(user);

            socket.emit('clanCastleWarResult', {
                success: true,
                userData: user,
                damage,
                status,
                message:
                    `🏰 Kale bombardımanı! ` +
                    `Klanına +${damage.toLocaleString('tr-TR')} hasar yazıldı. ` +
                    `⚔️ Karakter Gücü: ${characterPower.toLocaleString('tr-TR')} | ` +
                    `🪖 Ordu Gücü: ${armyPower.toLocaleString('tr-TR')} | ` +
                    (clanLevelState.castleDamageBonusPercent > 0
                        ? `🛡️ Klan Bonusu: +%${clanLevelState.castleDamageBonusPercent} | `
                        : '') +
                    `🎯 Kalan saldırı: ${status.myAttacksRemaining}/${CLAN_CASTLE_WAR_ATTACK_LIMIT}`
            });

            io.emit('clanCastleWarRefresh', {
                warKey: windowInfo.warKey
            });
        } catch (err) {
            console.error(
                'attackClanCastleWar hatası:',
                err
            );

            socket.emit(
                'clanCastleWarResult',
                {
                    success: false,
                    userData: user,
                    message:
                        'Kale saldırısı sırasında bir hata oluştu.'
                }
            );
        }
    });

    socket.on('createClan', async (data) => {
        if (!checkRateLimit(socket.id)) return;

        const user = users[socket.id];
        if (!user) return;

        if (user.clanId) {
            return socket.emit('clanResult', {
                success: false,
                userData: user,
                message: 'Zaten bir klana üyesin.'
            });
        }

        const name = normalizeClanName(data?.name);
        const tag = normalizeClanTag(data?.tag);

        if (!isValidClanName(name)) {
            return socket.emit('clanResult', {
                success: false,
                userData: user,
                message: 'Klan adı 3-24 karakter olmalı. Harf, rakam ve boşluk kullanabilirsin.'
            });
        }

        if (!isValidClanTag(tag)) {
            return socket.emit('clanResult', {
                success: false,
                userData: user,
                message: 'Klan etiketi 2-5 karakter olmalı. Harf ve rakam kullanabilirsin.'
            });
        }

        if ((Number(user.balance) || 0) < CLAN_CREATE_COST) {
            return socket.emit('clanResult', {
                success: false,
                userData: user,
                message: `Klan kurmak için ${CLAN_CREATE_COST.toLocaleString('tr-TR')} Altın gerekiyor.`
            });
        }

        let createdClan = null;

        try {
            const existingClan = await Clan.findOne({
                $or: [
                    { nameKey: getClanNameKey(name) },
                    { tagKey: tag }
                ]
            }).lean();

            if (existingClan) {
                return socket.emit('clanResult', {
                    success: false,
                    userData: user,
                    message: 'Bu klan adı veya etiketi başka bir klan tarafından kullanılıyor.'
                });
            }

            createdClan = new Clan({
                name,
                nameKey: getClanNameKey(name),
                tag,
                tagKey: tag,
                leaderId: user._id,
                members: [{
                    userId: user._id,
                    role: 'leader',
                    joinedAt: new Date()
                }]
            });

            await createdClan.save();

            user.balance -= CLAN_CREATE_COST;
            user.clanId = createdClan._id;
            user.clanRole = 'leader';
            user.clanContribution = Math.max(
                0,
                Number(user.clanContribution) || 0
            );

            try {
                await user.save();
            } catch (userSaveError) {
                await Clan.deleteOne({ _id: createdClan._id });
                throw userSaveError;
            }

            syncOnlineUserClan(
                user._id,
                createdClan._id,
                'leader'
            );

            socket.emit('clanResult', {
                success: true,
                userData: user,
                message:
                    `🛡️ [${tag}] ${name} klanı kuruldu! ` +
                    `${CLAN_CREATE_COST.toLocaleString('tr-TR')} Altın harcandı.`
            });

            await sendClanData(socket, user);
            broadcastClanRefresh(createdClan._id);
        } catch (err) {
            console.error('createClan hatası:', err);

            if (err?.code === 11000) {
                return socket.emit('clanResult', {
                    success: false,
                    userData: user,
                    message: 'Bu klan adı veya etiketi zaten kullanılıyor.'
                });
            }

            socket.emit('clanResult', {
                success: false,
                userData: user,
                message: 'Klan kurulurken bir hata oluştu.'
            });
        }
    });

    socket.on('joinClan', async (data) => {
        if (!checkRateLimit(socket.id)) return;

        const user = users[socket.id];
        if (!user) return;

        if (user.clanId) {
            return socket.emit('clanResult', {
                success: false,
                userData: user,
                message: 'Önce mevcut klanından ayrılmalısın.'
            });
        }

        const clanId = String(data?.clanId || '');

        if (!mongoose.Types.ObjectId.isValid(clanId)) {
            return socket.emit('clanResult', {
                success: false,
                userData: user,
                message: 'Geçersiz klan seçimi.'
            });
        }

        try {
            const clan = await Clan.findById(clanId);

            if (!clan) {
                return socket.emit('clanResult', {
                    success: false,
                    userData: user,
                    message: 'Klan bulunamadı.'
                });
            }

            const existingMembership = (clan.members || []).find(
                member => String(member.userId) === String(user._id)
            );

            if (existingMembership) {
                user.clanId = clan._id;
                user.clanRole = existingMembership.role || 'member';
                await user.save();

                syncOnlineUserClan(
                    user._id,
                    clan._id,
                    user.clanRole
                );

                return sendClanData(socket, user);
            }

            const maxMembers = Math.max(
                CLAN_BASE_MAX_MEMBERS,
                Number(clan.maxMembers) || CLAN_BASE_MAX_MEMBERS
            );

            if ((clan.members || []).length >= maxMembers) {
                return socket.emit('clanResult', {
                    success: false,
                    userData: user,
                    message: 'Bu klan maksimum üye sayısına ulaştı.'
                });
            }

            clan.members.push({
                userId: user._id,
                role: 'member',
                joinedAt: new Date()
            });

            await clan.save();

            user.clanId = clan._id;
            user.clanRole = 'member';

            try {
                await user.save();
            } catch (userSaveError) {
                clan.members = clan.members.filter(
                    member => String(member.userId) !== String(user._id)
                );
                await clan.save();
                throw userSaveError;
            }

            syncOnlineUserClan(user._id, clan._id, 'member');

            socket.emit('clanResult', {
                success: true,
                userData: user,
                message: `🛡️ [${clan.tag}] ${clan.name} klanına katıldın!`
            });

            broadcastClanRefresh(
                clan._id,
                `${user.username} klana katıldı.`
            );

            await sendClanData(socket, user);
        } catch (err) {
            console.error('joinClan hatası:', err);
            socket.emit('clanResult', {
                success: false,
                userData: user,
                message: 'Klana katılırken bir hata oluştu.'
            });
        }
    });

    socket.on('leaveClan', async () => {
        if (!checkRateLimit(socket.id)) return;

        const user = users[socket.id];

        if (!user?.clanId) {
            return socket.emit('clanResult', {
                success: false,
                userData: user,
                message: 'Bir klana üye değilsin.'
            });
        }

        try {
            const clan = await Clan.findById(user.clanId);

            if (!clan) {
                user.clanId = null;
                user.clanRole = null;
                await user.save();
                syncOnlineUserClan(user._id, null, null);

                socket.emit('clanData', {
                    clan: null,
                    userData: user
                });

                return socket.emit('clanResult', {
                    success: true,
                    userData: user,
                    message: 'Klan kaydı bulunamadı; üyelik kaydın temizlendi.'
                });
            }

            const leavingUserId = String(user._id);
            const isLeader =
                String(clan.leaderId) === leavingUserId;

            if (isLeader && (clan.members || []).length > 1) {
                const nextLeader =
                    clan.members.find(
                        member =>
                            String(member.userId) !== leavingUserId &&
                            member.role === 'officer'
                    ) ||
                    clan.members.find(
                        member =>
                            String(member.userId) !== leavingUserId
                    );

                if (!nextLeader) {
                    return socket.emit('clanResult', {
                        success: false,
                        userData: user,
                        message: 'Yeni klan lideri belirlenemedi.'
                    });
                }

                nextLeader.role = 'leader';
                clan.leaderId = nextLeader.userId;

                await User.updateOne(
                    { _id: nextLeader.userId },
                    { $set: { clanRole: 'leader' } }
                );

                syncOnlineUserClan(
                    nextLeader.userId,
                    clan._id,
                    'leader'
                );

                emitToOnlineUser(
                    nextLeader.userId,
                    'clanResult',
                    {
                        success: true,
                        message:
                            `👑 ${clan.name} klanının yeni lideri oldun!`
                    }
                );
            }

            clan.members = (clan.members || []).filter(
                member =>
                    String(member.userId) !== leavingUserId
            );

            user.clanId = null;
            user.clanRole = null;

            await user.save();
            syncOnlineUserClan(user._id, null, null);

            if (clan.members.length === 0) {
                await Clan.deleteOne({ _id: clan._id });

                socket.emit('clanResult', {
                    success: true,
                    userData: user,
                    message:
                        `🛡️ ${clan.name} klanından ayrıldın. ` +
                        `Klanda üye kalmadığı için klan dağıldı.`
                });
            } else {
                await clan.save();

                socket.emit('clanResult', {
                    success: true,
                    userData: user,
                    message: `🛡️ ${clan.name} klanından ayrıldın.`
                });

                broadcastClanRefresh(
                    clan._id,
                    `${user.username} klandan ayrıldı.`
                );
            }

            socket.emit('clanData', {
                clan: null,
                userData: user
            });
        } catch (err) {
            console.error('leaveClan hatası:', err);
            socket.emit('clanResult', {
                success: false,
                userData: user,
                message: 'Klandan ayrılırken bir hata oluştu.'
            });
        }
    });

    socket.on('donateClanGold', async (data) => {
        if (!checkRateLimit(socket.id)) return;

        const user = users[socket.id];

        if (!user?.clanId) {
            return socket.emit('clanResult', {
                success: false,
                userData: user,
                message: 'Bir klana üye değilsin.'
            });
        }

        const amount =
            Number.parseInt(data?.amount, 10);

        if (
            !Number.isInteger(amount) ||
            amount < 100 ||
            amount > 1000000
        ) {
            return socket.emit('clanResult', {
                success: false,
                userData: user,
                message:
                    'Bağış miktarı 100 ile 1.000.000 Altın arasında olmalı.'
            });
        }

        if ((Number(user.balance) || 0) < amount) {
            return socket.emit('clanResult', {
                success: false,
                userData: user,
                message: 'Bağış için yeterli Altının yok.'
            });
        }

        try {
            const clan = await Clan.findById(user.clanId);

            if (!clan) {
                return socket.emit('clanResult', {
                    success: false,
                    userData: user,
                    message: 'Klan bulunamadı.'
                });
            }

            const isMember = (clan.members || []).some(
                member =>
                    String(member.userId) === String(user._id)
            );

            if (!isMember) {
                return socket.emit('clanResult', {
                    success: false,
                    userData: user,
                    message: 'Klan üyeliğin doğrulanamadı.'
                });
            }

            user.balance -= amount;
            user.clanContribution =
                Math.max(0, Number(user.clanContribution) || 0) +
                amount;

            clan.treasury =
                Math.max(0, Number(clan.treasury) || 0) +
                amount;

            await Promise.all([
                user.save(),
                clan.save()
            ]);

            socket.emit('clanResult', {
                success: true,
                userData: user,
                message:
                    `💰 Klan hazinesine ` +
                    `${amount.toLocaleString('tr-TR')} Altın bağışladın.`
            });

            broadcastClanRefresh(
                clan._id,
                `${user.username} klan hazinesine bağış yaptı.`
            );

            await sendClanData(socket, user);
        } catch (err) {
            console.error('donateClanGold hatası:', err);
            socket.emit('clanResult', {
                success: false,
                userData: user,
                message: 'Bağış işlemi tamamlanamadı.'
            });
        }
    });

    socket.on('upgradeClan', async () => {
        if (!checkRateLimit(socket.id)) return;

        const user = users[socket.id];
        if (!user?.clanId || user.clanRole !== 'leader') {
            return socket.emit('clanResult', {
                success: false,
                userData: user,
                message: 'Klan geliştirmesini yalnızca Klan Lideri yapabilir.'
            });
        }

        try {
            const clan = await Clan.findById(user.clanId);
            if (!clan) {
                return socket.emit('clanResult', { success: false, userData: user, message: 'Klan bulunamadı.' });
            }

            const currentState = getClanLevelState(clan);
            if (currentState.isMaxLevel) {
                return socket.emit('clanResult', {
                    success: false,
                    userData: user,
                    message: '🏛️ Klan zaten maksimum seviye olan 5. seviyede.'
                });
            }

            const cost = currentState.nextUpgradeCost;
            if ((Number(clan.treasury) || 0) < cost) {
                return socket.emit('clanResult', {
                    success: false,
                    userData: user,
                    message: `💰 Klan Seviye ${currentState.level + 1} için ${cost.toLocaleString('tr-TR')} Altın hazine gerekiyor.`
                });
            }

            const nextLevel = currentState.level + 1;
            const nextState = getClanLevelState({ level: nextLevel });

            const updatedClan = await Clan.findOneAndUpdate(
                { _id: clan._id, level: currentState.level, treasury: { $gte: cost } },
                { $inc: { treasury: -cost }, $set: { level: nextLevel, maxMembers: nextState.maxMembers } },
                { new: true }
            );

            if (!updatedClan) {
                return socket.emit('clanResult', {
                    success: false,
                    userData: user,
                    message: 'Klan geliştirmesi tamamlanamadı. Hazine veya seviye değişmiş olabilir.'
                });
            }

            socket.emit('clanResult', {
                success: true,
                userData: user,
                message:
                    `🏛️ Klan Seviye ${nextLevel} oldu! Unvan: ${nextState.title}. ` +
                    (nextState.castleDamageBonusPercent > 0 ? `🏰 Kale Hasarı +%${nextState.castleDamageBonusPercent}. ` : '') +
                    `👥 Kapasite: ${nextState.maxMembers}.`
            });

            broadcastClanRefresh(updatedClan._id, `🏛️ ${updatedClan.name} Klan Seviye ${nextLevel} oldu!`);
            await sendClanData(socket, user);
        } catch (err) {
            console.error('upgradeClan hatası:', err);
            socket.emit('clanResult', {
                success: false,
                userData: user,
                message: 'Klan geliştirmesi sırasında bir hata oluştu.'
            });
        }
    });

    socket.on('setClanRole', async (data) => {
        if (!checkRateLimit(socket.id)) return;

        const user = users[socket.id];

        if (!user?.clanId || user.clanRole !== 'leader') {
            return socket.emit('clanResult', {
                success: false,
                userData: user,
                message:
                    'Bu işlem yalnızca klan liderine açıktır.'
            });
        }

        const targetUserId =
            String(data?.userId || '');

        const newRole =
            String(data?.role || '');

        if (
            !mongoose.Types.ObjectId.isValid(targetUserId) ||
            !['officer', 'member'].includes(newRole)
        ) {
            return socket.emit('clanResult', {
                success: false,
                userData: user,
                message: 'Geçersiz rol işlemi.'
            });
        }

        if (targetUserId === String(user._id)) {
            return socket.emit('clanResult', {
                success: false,
                userData: user,
                message:
                    'Lider kendi rolünü bu menüden değiştiremez.'
            });
        }

        try {
            const clan = await Clan.findById(user.clanId);
            if (!clan) return;

            const member = (clan.members || []).find(
                clanMember =>
                    String(clanMember.userId) === targetUserId
            );

            if (!member || member.role === 'leader') {
                return socket.emit('clanResult', {
                    success: false,
                    userData: user,
                    message: 'Üye bulunamadı.'
                });
            }

            member.role = newRole;
            await clan.save();

            await User.updateOne(
                { _id: targetUserId },
                { $set: { clanRole: newRole } }
            );

            syncOnlineUserClan(
                targetUserId,
                clan._id,
                newRole
            );

            const roleText =
                newRole === 'officer'
                    ? 'Komutan'
                    : 'Üye';

            socket.emit('clanResult', {
                success: true,
                userData: user,
                message:
                    `Üyenin rolü ${roleText} olarak değiştirildi.`
            });

            emitToOnlineUser(
                targetUserId,
                'clanResult',
                {
                    success: true,
                    message:
                        `🛡️ Klan rolün ${roleText} olarak değiştirildi.`
                }
            );

            broadcastClanRefresh(clan._id);
            await sendClanData(socket, user);
        } catch (err) {
            console.error('setClanRole hatası:', err);
            socket.emit('clanResult', {
                success: false,
                userData: user,
                message: 'Rol değiştirilemedi.'
            });
        }
    });

    socket.on('kickClanMember', async (data) => {
        if (!checkRateLimit(socket.id)) return;

        const user = users[socket.id];

        if (!user?.clanId || user.clanRole !== 'leader') {
            return socket.emit('clanResult', {
                success: false,
                userData: user,
                message:
                    'Bu işlem yalnızca klan liderine açıktır.'
            });
        }

        const targetUserId =
            String(data?.userId || '');

        if (
            !mongoose.Types.ObjectId.isValid(targetUserId) ||
            targetUserId === String(user._id)
        ) {
            return socket.emit('clanResult', {
                success: false,
                userData: user,
                message: 'Geçersiz üye.'
            });
        }

        try {
            const clan = await Clan.findById(user.clanId);
            if (!clan) return;

            const targetMember =
                (clan.members || []).find(
                    member =>
                        String(member.userId) === targetUserId
                );

            if (!targetMember || targetMember.role === 'leader') {
                return socket.emit('clanResult', {
                    success: false,
                    userData: user,
                    message: 'Üye bulunamadı.'
                });
            }

            clan.members = clan.members.filter(
                member =>
                    String(member.userId) !== targetUserId
            );

            await clan.save();

            const kickedUser =
                await User.findById(targetUserId);

            const kickedName =
                kickedUser?.username || 'Oyuncu';

            if (kickedUser) {
                kickedUser.clanId = null;
                kickedUser.clanRole = null;
                await kickedUser.save();
            }

            syncOnlineUserClan(
                targetUserId,
                null,
                null
            );

            emitToOnlineUser(
                targetUserId,
                'clanResult',
                {
                    success: false,
                    userData: kickedUser || undefined,
                    message:
                        `🛡️ ${clan.name} klanından çıkarıldın.`
                }
            );

            emitToOnlineUser(
                targetUserId,
                'clanData',
                {
                    clan: null,
                    userData: kickedUser || undefined
                }
            );

            socket.emit('clanResult', {
                success: true,
                userData: user,
                message:
                    `${kickedName} klandan çıkarıldı.`
            });

            broadcastClanRefresh(clan._id);
            await sendClanData(socket, user);
        } catch (err) {
            console.error('kickClanMember hatası:', err);
            socket.emit('clanResult', {
                success: false,
                userData: user,
                message: 'Üye klandan çıkarılamadı.'
            });
        }
    });

    socket.on('sendClanChatMessage', async (data) => {
        if (!checkRateLimit(socket.id)) {
            return socket.emit('clanResult', {
                success: false,
                message: 'Çok hızlı mesaj gönderiyorsun.'
            });
        }

        const user = users[socket.id];

        if (!user?.clanId) {
            return socket.emit('clanResult', {
                success: false,
                userData: user,
                message: 'Bir klana üye değilsin.'
            });
        }

        const message =
            String(data?.message || '')
                .trim()
                .substring(0, 150);

        if (!message) return;

        try {
            const clan =
                await Clan.findById(user.clanId);

            if (!clan) return;

            const membership =
                (clan.members || []).find(
                    member =>
                        String(member.userId) ===
                        String(user._id)
                );

            if (!membership) {
                return socket.emit('clanResult', {
                    success: false,
                    userData: user,
                    message:
                        'Klan üyeliğin doğrulanamadı.'
                });
            }

            const chatMessage = {
                userId: user._id,
                username: user.username,
                message,
                createdAt: new Date()
            };

            clan.chatMessages.push(chatMessage);

            if (
                clan.chatMessages.length >
                CLAN_CHAT_HISTORY_LIMIT
            ) {
                clan.chatMessages =
                    clan.chatMessages.slice(
                        -CLAN_CHAT_HISTORY_LIMIT
                    );
            }

            clan.markModified('chatMessages');
            await clan.save();

            for (
                const [socketId, onlineUser]
                of Object.entries(users)
            ) {
                if (!onlineUser?.clanId) continue;

                if (
                    String(onlineUser.clanId) !==
                    String(clan._id)
                ) {
                    continue;
                }

                io.to(socketId).emit(
                    'receiveClanChatMessage',
                    {
                        userId: String(user._id),
                        username: user.username,
                        message,
                        createdAt: chatMessage.createdAt
                    }
                );
            }
        } catch (err) {
            console.error(
                'sendClanChatMessage hatası:',
                err
            );

            socket.emit('clanResult', {
                success: false,
                message: 'Klan mesajı gönderilemedi.'
            });
        }
    });

    socket.on('sendChatMessage', (data) => {
        if (!checkRateLimit(socket.id)) return socket.emit('errorMessage', "Çok hızlı mesaj gönderiyorsun!");
        const safeMsg = data.message.substring(0, 100); 
        io.emit('receiveChatMessage', { username: users[socket.id]?.username, message: safeMsg });
    });

    socket.on('disconnect', () => {
        delete users[socket.id];
        broadcastOnlinePlayerCount();
    });
});

// Online oyuncuların Sefer Hakkını otomatik yenile.
// Her eksik hak için sırayla 3 dakikada 1 hak geri gelir.
setInterval(async () => {
    for (const id in users) {
        const u = users[id];
        if (!u) continue;

        try {
            const changed = checkSeferRefill(u);

            if (changed) {
                await User.updateOne(
                    { _id: u._id },
                    {
                        $set: {
                            seferLimiti: u.seferLimiti,
                            seferNextRefill: u.seferNextRefill
                        }
                    }
                );

                io.to(id).emit('statUpdated', u);
            }
        } catch (err) {
            console.error('Sefer otomatik yenileme hatası:', err);
        }
    }
}, 10000);

setInterval(async () => {
    for (const id in users) {
        const u = users[id];

        if (!u || !Array.isArray(u.estates) || u.estates.length === 0) {
            continue;
        }

        try {
            const status = await getTimarStatusForUser(u, true);
            await u.save();
            io.to(id).emit('timarStatus', status);
        } catch (err) {
            console.error('Tımar otomatik gelir hatası:', err);
        }
    }
}, 60000);

// Klan Kale Savaşlarını süre bittiğinde otomatik sonuçlandır.
setInterval(async () => {
    try {
        await finalizeExpiredClanCastleWars();
    } catch (err) {
        console.error(
            'Klan Kale Savaşı otomatik sonuçlandırma hatası:',
            err
        );
    }
}, 30000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu aktif: ${PORT}`);
    console.log(`OYUN BUILD: ${GAME_BUILD_ID} | Macera Paketi: AKTİF | Dünya Bossu: AKTİF | Sezon: AKTİF | Klan Kale: 19:00 | 100 Onur = ${HONOR_RUBY_REWARD} Yakut`);
});
