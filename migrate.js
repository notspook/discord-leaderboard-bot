const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("./data.db");

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS booster_whitelist (userId TEXT PRIMARY KEY, note TEXT DEFAULT '')`);
  db.run(`CREATE TABLE IF NOT EXISTS booster_blacklist (userId TEXT PRIMARY KEY, note TEXT DEFAULT '')`);
  db.run(`CREATE TABLE IF NOT EXISTS booster_roles (userId TEXT PRIMARY KEY, roleId TEXT NOT NULL, sharedWith TEXT DEFAULT '[]')`);
  db.run(`CREATE TABLE IF NOT EXISTS dm_messages (key TEXT PRIMARY KEY, value TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS dm_inbox (id INTEGER PRIMARY KEY AUTOINCREMENT, userId TEXT NOT NULL, username TEXT NOT NULL, content TEXT NOT NULL, timestamp INTEGER NOT NULL, read INTEGER DEFAULT 0)`);
  db.run(`CREATE TABLE IF NOT EXISTS mod_banned (userId TEXT PRIMARY KEY, username TEXT, reason TEXT, bannedAt INTEGER)`);
  db.run(`CREATE TABLE IF NOT EXISTS mod_settings (key TEXT PRIMARY KEY, value TEXT)`);
  db.run(`INSERT OR IGNORE INTO mod_settings (key, value) VALUES ('auto_reply_enabled', '1')`);
  db.run(`INSERT OR IGNORE INTO mod_settings (key, value) VALUES ('raid_mode', '0')`);
  db.run(`INSERT OR IGNORE INTO mod_settings (key, value) VALUES ('raid_account_age_days', '7')`);

  const defaults = {
    dm_boost_welcome: "🎉 **Thanks for boosting the server!**\n\nAs a booster perk you get your own **custom role** — name it whatever you want and pick any color.\n\n**Here's how to use it:**\n`!boosterrole` — create or update your custom role\n`!sharerole @user1 @user2 @user3` — share your role with up to 3 people\n\nThe role is purely cosmetic (no extra permissions) and sits at the bottom of the role list.\nIf you ever stop boosting, the role will be automatically removed. 💎",
    dm_boost_removed: "💔 Your server boost has ended so your custom role has been removed.\nIf you boost again, use `!boosterrole` to recreate it anytime!",
    dm_auto_reply: "Hey baby i cant chat here, join https://discord.gg/VXxNvGHA6g @not spook or any of the admins can help you with everything else my love."
  };

  Object.entries(defaults).forEach(([key, value]) => {
    db.run(`INSERT OR IGNORE INTO dm_messages (key, value) VALUES (?, ?)`, [key, value]);
  });

  console.log("✅ Migration complete");
});

setTimeout(() => db.close(), 1000);
