const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(__dirname + '/public'));

const MAX_SEFER_LIMITI = 20;
const REFILL_INTERVAL = 3 * 60 * 1000;
const MAX_LEVEL = 99;

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
    archer:  { name: 'Okçu',    icon: '🏹', cost: 250,  power: 10 },
    warrior: { name: 'Savaşçı', icon: '⚔️', cost: 500,  power: 20 },
    cavalry: { name: 'Süvari',  icon: '🐎', cost: 1000, power: 35 }
};

const CASTLE_WALL_POWER = 500;
const CASTLE_DEFENSE_BONUS = 1.15;

const NPC_CASTLE_ARMY = {
    archer: 50,
    warrior: 30,
    cavalry: 20
};

function normalizeArmy(user) {
    if (!user.army) {
        user.army = { archer: 0, warrior: 0, cavalry: 0 };
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
        cavalry: Math.max(0, Number.parseInt(army?.cavalry, 10) || 0)
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
    return safe.archer + safe.warrior + safe.cavalry;
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
            available: false
        };
        changed = true;
    }

    for (const type of ['archer', 'warrior', 'cavalry']) {
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
    return `🏹 ${lost.archer || 0} Okçu | ⚔️ ${lost.warrior || 0} Savaşçı | 🐎 ${lost.cavalry || 0} Süvari`;
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
    metinStoneHp: { type: [Number], default: () => Object.values(METIN_STONES).map(stone => stone.maxHp) },
    metinStoneRespawnAt: { type: [Number], default: () => Object.values(METIN_STONES).map(() => 0) },
    str: { type: Number, default: 5 },
    vit: { type: Number, default: 5 },
    statPoints: { type: Number, default: 0 },
    hp: { type: Number, default: 100 },
    honor: { type: Number, default: 0 },
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
        cavalry: { type: Number, default: 0 }
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
    inventory: { type: Array, default: [] }
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
            onlineUser.army = { archer: 0, warrior: 0, cavalry: 0 };
        }

        onlineUser.army.archer = army.archer || 0;
        onlineUser.army.warrior = army.warrior || 0;
        onlineUser.army.cavalry = army.cavalry || 0;
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

io.on('connection', (socket) => {
    
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
            await dbUser.save();
            
            users[socket.id] = dbUser;
            socket.emit('authResult', { success: true, message: "Giriş başarılı!", token: token });
            
            const userData = dbUser.toObject();
            userData.offlineGoldEarned = offlineGold;
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
            await dbUser.save();
            
            users[socket.id] = dbUser;
            const userData = dbUser.toObject();
            userData.offlineGoldEarned = offlineGold;
            socket.emit('userData', userData);
        } catch (err) { 
            console.error(err);
        }
    });

    socket.on('logout', () => { 
        delete users[socket.id]; 
        socket.emit('logoutSuccess'); 
    });

    socket.on('getOverviewStatus', async () => {
        if (!checkRateLimit(socket.id)) return;

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
            }
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
                    message: 'Tek seferde 1 ile 100 arasında asker yetiştirebilirsin.'
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
                    `${troop.icon} ${quantity} ${troop.name} yetiştirildi! ` +
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

            user.lastCastleLosses = {
                archer: attackerLossResult.lost.archer || 0,
                warrior: attackerLossResult.lost.warrior || 0,
                cavalry: attackerLossResult.lost.cavalry || 0,
                available:
                    (
                        (attackerLossResult.lost.archer || 0) +
                        (attackerLossResult.lost.warrior || 0) +
                        (attackerLossResult.lost.cavalry || 0)
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

                normalizeSiegeMarketState(defenderUser);

                defenderUser.lastCastleLosses = {
                    archer: defenderLossResult.lost.archer || 0,
                    warrior: defenderLossResult.lost.warrior || 0,
                    cavalry: defenderLossResult.lost.cavalry || 0,
                    available:
                        (
                            (defenderLossResult.lost.archer || 0) +
                            (defenderLossResult.lost.warrior || 0) +
                            (defenderLossResult.lost.cavalry || 0)
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

            if (attackerWon) {
                goldReward = Math.floor(Math.random() * 50) + 30;
                honorChange = 15;

                attacker.balance += goldReward;
                attacker.honor = (attacker.honor || 0) + honorChange;
                attacker.arenaWins = (attacker.arenaWins || 0) + 1;

                resultMessage =
                    `🏆 ZAFER! ${defender.username} mağlup edildi. ` +
                    `Ödül: +${goldReward} Altın 🪙 ve +${honorChange} Onur 🌟!`;
            } else {
                honorChange = -5;

                attacker.honor = Math.max(
                    0,
                    (attacker.honor || 0) + honorChange
                );

                resultMessage =
                    `💀 MAĞLUBİYET! ${defender.username} arena savaşını kazandı. ` +
                    `5 Onur kaybettin.`;
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
            (Number(losses.cavalry) || 0);

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
            cavalry: Math.ceil((Number(losses.cavalry) || 0) * 0.10)
        };

        user.balance -= cost;

        user.army.archer += restored.archer;
        user.army.warrior += restored.warrior;
        user.army.cavalry += restored.cavalry;

        user.lastCastleLosses = {
            archer: 0,
            warrior: 0,
            cavalry: 0,
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
                `🐎 +${restored.cavalry} Süvari.`
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

    socket.on('sendChatMessage', (data) => {
        if (!checkRateLimit(socket.id)) return socket.emit('errorMessage', "Çok hızlı mesaj gönderiyorsun!");
        const safeMsg = data.message.substring(0, 100); 
        io.emit('receiveChatMessage', { username: users[socket.id]?.username, message: safeMsg });
    });

    socket.on('disconnect', () => delete users[socket.id]);
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Sunucu aktif: ${PORT}`));
