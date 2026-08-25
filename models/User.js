
const userSchema = new mongoose.Schema({
    username: String,
    password: String,
    balance: { type: Number, default: 0 },
    rubies: { type: Number, default: 10 },
    level: { type: Number, default: 1 },
    exp: { type: Number, default: 0 },
    hp: { type: Number, default: 100 },
    str: { type: Number, default: 5 },
    vit: { type: Number, default: 5 },
    statPoints: { type: Number, default: 0 },
    seferLimiti: { type: Number, default: 20 },
    estates: { type: Array, default: [] },
    upgrades: { type: Object, default: {} },
    inventory: { type: Array, default: [] },
    equipped: { type: Object, default: {} },
    
    // GÜNLÜK HEDİYE ZAMAN TAKİBİ ALANI
    lastDailyGift: { type: Date, default: null }
});
