const sqlite3 = require("sqlite3").verbose();

const db = new sqlite3.Database("./data.db");

db.serialize(() => {

  // ---------------- USERS TABLE ----------------
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      userId TEXT PRIMARY KEY,
      messages INTEGER DEFAULT 0,
      voiceSeconds INTEGER DEFAULT 0,
      lastJoin INTEGER DEFAULT NULL,
      dailyMessages INTEGER DEFAULT 0,
      dailyVoice INTEGER DEFAULT 0,
      larpStreak INTEGER DEFAULT 0,
      larpWins INTEGER DEFAULT 0
    )
  `);

  // ---------------- BOT STATE TABLE ----------------
  db.run(`
    CREATE TABLE IF NOT EXISTS bot_data (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  // ---------------- SAFE MIGRATIONS ----------------
  // These prevent crashes if columns already exist

  const safeAddColumn = (name, type) => {
    db.run(`ALTER TABLE users ADD COLUMN ${name} ${type}`, () => {});
  };

  safeAddColumn("dailyMessages", "INTEGER DEFAULT 0");
  safeAddColumn("dailyVoice", "INTEGER DEFAULT 0");
  safeAddColumn("larpStreak", "INTEGER DEFAULT 0");
  safeAddColumn("larpWins", "INTEGER DEFAULT 0");

});

module.exports = db;