const db = require("./database");

// -------------------- TABLES --------------------
db.run(`CREATE TABLE IF NOT EXISTS dm_inbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId TEXT NOT NULL,
  username TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  read INTEGER DEFAULT 0
)`, () => {});

db.run(`CREATE TABLE IF NOT EXISTS mod_banned (
  userId TEXT PRIMARY KEY,
  username TEXT,
  reason TEXT,
  bannedAt INTEGER
)`, () => {});

db.run(`CREATE TABLE IF NOT EXISTS mod_settings (
  key TEXT PRIMARY KEY,
  value TEXT
)`, () => {});

// Default settings
db.run(`INSERT OR IGNORE INTO mod_settings (key, value) VALUES ('auto_reply_enabled', '1')`, () => {});
db.run(`INSERT OR IGNORE INTO mod_settings (key, value) VALUES ('raid_mode', '0')`, () => {});
db.run(`INSERT OR IGNORE INTO mod_settings (key, value) VALUES ('raid_account_age_days', '7')`, () => {});

// In-memory join tracker for raid detection: { userId: joinTimestamp }
const recentJoins = new Map();
const RAID_WINDOW_MS = 10000;  // 10 seconds
const RAID_THRESHOLD = 5;       // 5 joins in 10s = raid alert

// -------------------- HELPERS --------------------
function getModSetting(key) {
  return new Promise(res =>
    db.get(`SELECT value FROM mod_settings WHERE key = ?`, [key], (e, r) => res(r?.value ?? null))
  );
}

function setModSetting(key, value) {
  return new Promise(res =>
    db.run(`INSERT OR REPLACE INTO mod_settings (key, value) VALUES (?, ?)`, [key, String(value)], res)
  );
}

// -------------------- DM INBOX --------------------
function saveDM(userId, username, content) {
  return new Promise(res =>
    db.run(
      `INSERT INTO dm_inbox (userId, username, content, timestamp) VALUES (?, ?, ?, ?)`,
      [userId, username, content, Date.now()],
      res
    )
  );
}

function getInbox() {
  return new Promise(res =>
    db.all(`SELECT * FROM dm_inbox ORDER BY timestamp DESC LIMIT 100`, [], (e, r) => res(r || []))
  );
}

function markRead(id) {
  return new Promise(res =>
    db.run(`UPDATE dm_inbox SET read = 1 WHERE id = ?`, [id], res)
  );
}

function markAllRead() {
  return new Promise(res =>
    db.run(`UPDATE dm_inbox SET read = 1`, [], res)
  );
}

function deleteDM(id) {
  return new Promise(res =>
    db.run(`DELETE FROM dm_inbox WHERE id = ?`, [id], res)
  );
}

// -------------------- RAID DETECTION --------------------
async function handleMemberJoin(member, notifyChannel) {
  const now = Date.now();
  recentJoins.set(member.id, now);

  // Clean up old entries
  for (const [id, ts] of recentJoins.entries()) {
    if (now - ts > RAID_WINDOW_MS * 6) recentJoins.delete(id);
  }

  // Count joins in the last window
  const recent = [...recentJoins.values()].filter(ts => now - ts < RAID_WINDOW_MS);

  const raidMode = await getModSetting('raid_mode');
  const minAgeDays = parseInt(await getModSetting('raid_account_age_days') || '7');

  // Check account age
  const accountAgeDays = (now - member.user.createdTimestamp) / (1000 * 60 * 60 * 24);
  const isNewAccount = accountAgeDays < minAgeDays;

  // Auto-kick new accounts if raid mode is on
  if (raidMode === '1' && isNewAccount) {
    await member.kick(`Raid mode active — account too new (${Math.floor(accountAgeDays)} days old)`).catch(() => {});
    if (notifyChannel) {
      notifyChannel.send(`🛡️ **Raid Mode:** Kicked <@${member.id}> (\`${member.user.tag}\`) — account only ${Math.floor(accountAgeDays)} days old.`).catch(() => {});
    }
    return;
  }

  // Alert if join spike detected
  if (recent.length >= RAID_THRESHOLD && notifyChannel) {
    notifyChannel.send(
      `⚠️ **Possible Raid Detected!** ${recent.length} users joined in the last ${RAID_WINDOW_MS / 1000}s.\n` +
      `Use the dashboard **Mod** section to review and ban.\n` +
      `Enable **Raid Mode** to auto-kick new accounts.`
    ).catch(() => {});
  }
}

// -------------------- BAN WITH MESSAGE DELETE --------------------
async function banUser(guild, userId, reason = "Banned via dashboard", deleteMessageDays = 7) {
  try {
    await guild.members.ban(userId, {
      deleteMessageSeconds: deleteMessageDays * 24 * 60 * 60,
      reason
    });
    db.run(`INSERT OR REPLACE INTO mod_banned (userId, username, reason, bannedAt) VALUES (?, ?, ?, ?)`,
      [userId, userId, reason, Date.now()]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function unbanUser(guild, userId) {
  try {
    await guild.members.unban(userId);
    db.run(`DELETE FROM mod_banned WHERE userId = ?`, [userId]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = {
  saveDM, getInbox, markRead, markAllRead, deleteDM,
  handleMemberJoin, banUser, unbanUser,
  getModSetting, setModSetting
};
