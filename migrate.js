const sqlite3 = require("sqlite3").verbose();
const path = require("path");

process.env.DATABASE_URL = "postgresql://larp_bot_db_user:YdrB7rwTnNq5JsHyfS4d31zsa8YjUtR1@dpg-d96cqipo3t8c73b61lvg-a.virginia-postgres.render.com:5432/larp_bot_db";

const pgDb = require("./database");
const sdb = new sqlite3.Database(path.join(__dirname, "data.db"));

const CREATE_TABLES = [
  `CREATE TABLE IF NOT EXISTS users (userId TEXT PRIMARY KEY, messages INTEGER DEFAULT 0, voiceSeconds INTEGER DEFAULT 0, lastJoin INTEGER, dailyMessages INTEGER DEFAULT 0, dailyVoice INTEGER DEFAULT 0, larpStreak INTEGER DEFAULT 0, larpWins INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS bot_data (key TEXT PRIMARY KEY, value TEXT)`,
  `CREATE TABLE IF NOT EXISTS booster_roles (userId TEXT PRIMARY KEY, roleId TEXT NOT NULL, sharedWith TEXT DEFAULT '[]')`,
  `CREATE TABLE IF NOT EXISTS booster_whitelist (userId TEXT PRIMARY KEY, note TEXT DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS booster_blacklist (userId TEXT PRIMARY KEY, note TEXT DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS dm_messages (key TEXT PRIMARY KEY, value TEXT)`,
  `CREATE TABLE IF NOT EXISTS image_only_channels (channelId TEXT PRIMARY KEY, label TEXT DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS dm_inbox (id INTEGER PRIMARY KEY AUTOINCREMENT, userId TEXT NOT NULL, username TEXT NOT NULL, content TEXT NOT NULL, timestamp INTEGER NOT NULL, read INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS mod_banned (userId TEXT PRIMARY KEY, username TEXT, reason TEXT, bannedAt INTEGER)`,
  `CREATE TABLE IF NOT EXISTS mod_settings (key TEXT PRIMARY KEY, value TEXT)`
];

async function migrate() {
  // Create tables
  for (const sql of CREATE_TABLES) {
    await new Promise(res => pgDb.run(sql, [], res));
  }
  console.log("Tables created");

  // Migrate each table's data
  const tables = await new Promise(res => {
    sdb.all(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`, [], (e, r) => res(r || []));
  });

  for (const t of tables) {
    const tableName = t.name;
    const rows = await new Promise(res => {
      sdb.all(`SELECT * FROM "${tableName}"`, [], (e, r) => res(r || []));
    });
    if (rows.length === 0) { console.log(`${tableName}: 0 rows`); continue; }

    const cols = Object.keys(rows[0]);
    const placeholders = cols.map(() => "?").join(", ");
    const insertSql = `INSERT OR IGNORE INTO "${tableName}" (${cols.join(", ")}) VALUES (${placeholders})`;

    let success = 0;
    for (const row of rows) {
      const vals = cols.map(c => row[c]);
      await new Promise(res => {
        pgDb.run(insertSql, vals, (e) => {
          if (!e) success++;
          res();
        });
      });
    }
    console.log(`${tableName}: ${success}/${rows.length} rows migrated`);
  }

  console.log("✅ Migration complete!");
  sdb.close();
}

migrate().catch(e => console.error("Migration failed:", e));
