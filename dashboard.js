const express = require("express");
const session = require("express-session");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.DASHBOARD_PASSWORD || "admin";
const DB_PATH = path.join(__dirname, "data.db");

let botProcess = null;
let logs = [];
const MAX_LOGS = 200;

// Open DB directly in dashboard for admin queries
const db = new sqlite3.Database(DB_PATH);

function dbGet(sql, params = []) {
  return new Promise((res, rej) => db.get(sql, params, (e, r) => e ? rej(e) : res(r)));
}
function dbAll(sql, params = []) {
  return new Promise((res, rej) => db.all(sql, params, (e, r) => e ? rej(e) : res(r || [])));
}
function dbRun(sql, params = []) {
  return new Promise((res, rej) => db.run(sql, params, e => e ? rej(e) : res()));
}

// Ensure tables exist
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS booster_whitelist (userId TEXT PRIMARY KEY, note TEXT DEFAULT '')`);
  db.run(`CREATE TABLE IF NOT EXISTS booster_blacklist (userId TEXT PRIMARY KEY, note TEXT DEFAULT '')`);
  db.run(`CREATE TABLE IF NOT EXISTS booster_roles (userId TEXT PRIMARY KEY, roleId TEXT NOT NULL, sharedWith TEXT DEFAULT '[]')`);
  db.run(`CREATE TABLE IF NOT EXISTS bot_data (key TEXT PRIMARY KEY, value TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS dm_messages (key TEXT PRIMARY KEY, value TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS image_only_channels (channelId TEXT PRIMARY KEY, label TEXT DEFAULT '')`);
  db.run(`CREATE TABLE IF NOT EXISTS dm_inbox (id INTEGER PRIMARY KEY AUTOINCREMENT, userId TEXT NOT NULL, username TEXT NOT NULL, content TEXT NOT NULL, timestamp INTEGER NOT NULL, read INTEGER DEFAULT 0)`);
  db.run(`CREATE TABLE IF NOT EXISTS mod_banned (userId TEXT PRIMARY KEY, username TEXT, reason TEXT, bannedAt INTEGER)`);
  db.run(`CREATE TABLE IF NOT EXISTS mod_settings (key TEXT PRIMARY KEY, value TEXT)`);
  db.run(`INSERT OR IGNORE INTO mod_settings (key, value) VALUES ('auto_reply_enabled', '1')`);
  db.run(`INSERT OR IGNORE INTO mod_settings (key, value) VALUES ('raid_mode', '0')`);
  db.run(`INSERT OR IGNORE INTO mod_settings (key, value) VALUES ('raid_account_age_days', '7')`);
});

function getGuildId() {
  return process.env.GUILD_ID || null;
}
// Seed the 4 reveal channels as defaults if table is empty
const REVEAL_CHANNELS = [
  { channelId: "1514725963819122728", label: "reveal-1" },
  { channelId: "1488342643938295944", label: "reveal-2" },
  { channelId: "1493190299206553620", label: "reveal-3" },
  { channelId: "1512900521470726315", label: "reveal-4" },
];
REVEAL_CHANNELS.forEach(({ channelId, label }) => {
  db.run(`INSERT OR IGNORE INTO image_only_channels (channelId, label) VALUES (?, ?)`, [channelId, label]);
});

// Seed default DM messages if not set
const DEFAULT_DMS = {
  dm_boost_welcome:
    "🎉 **Thanks for boosting the server!**\n\nAs a booster perk you get your own **custom role** — name it whatever you want and pick any color.\n\n**Here's how to use it:**\n`!boosterrole` — create or update your custom role\n`!sharerole @user1 @user2 @user3` — share your role with up to 3 people\n\nThe role is purely cosmetic (no extra permissions) and sits at the bottom of the role list.\nIf you ever stop boosting, the role will be automatically removed. 💎",
  dm_boost_removed:
    "💔 Your server boost has ended so your custom role has been removed.\nIf you boost again, use `!boosterrole` to recreate it anytime!",
  dm_auto_reply:
    "Hey baby i cant chat here, join https://discord.gg/VXxNvGHA6g @not spook or any of the admins can help you with everything else my love."
};

Object.entries(DEFAULT_DMS).forEach(([key, value]) => {
  db.run(`INSERT OR IGNORE INTO dm_messages (key, value) VALUES (?, ?)`, [key, value]);
});

function addLog(line) {
  const entry = { time: new Date().toLocaleTimeString("en-US", { hour12: false }), text: line.trim() };
  logs.push(entry);
  if (logs.length > MAX_LOGS) logs.shift();
}

function startBot() {
  if (botProcess) return;
  botProcess = spawn(process.execPath, ["index.js"], { cwd: __dirname });
  addLog("⚡ Bot started");
  botProcess.stdout.on("data", d => d.toString().split("\n").filter(Boolean).forEach(addLog));
  botProcess.stderr.on("data", d => d.toString().split("\n").filter(Boolean).forEach(l => addLog("⚠ " + l)));
  botProcess.on("exit", code => { addLog(`🔴 Bot exited (code ${code})`); botProcess = null; });
}

function stopBot() {
  if (!botProcess) return;
  botProcess.removeAllListeners();
  botProcess.kill("SIGKILL");
  botProcess = null;
  addLog("🔴 Bot stopped");
}

startBot();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.DASHBOARD_SECRET || "larpbotdash",
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 }
}));

function requireAuth(req, res, next) {
  if (req.session.authed) return next();
  res.redirect("/login");
}

// -------------------- LOGIN --------------------
app.get("/login", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LARP Bot — Login</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0d0e10;color:#dcddde;font-family:'Inter',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#1e1f22;border:1px solid #2b2d31;border-radius:12px;padding:40px;width:360px}
.logo{text-align:center;margin-bottom:32px}.logo h1{font-size:22px;font-weight:700;color:#fff}.logo p{font-size:13px;color:#72767d;margin-top:4px}
label{display:block;font-size:12px;font-weight:600;color:#b5bac1;margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px}
input{width:100%;background:#2b2d31;border:1px solid #3b3d44;border-radius:8px;padding:10px 14px;color:#dcddde;font-size:14px;outline:none;transition:border .2s}
input:focus{border-color:#5865f2}
button{width:100%;background:#5865f2;color:#fff;border:none;border-radius:8px;padding:11px;font-size:14px;font-weight:600;cursor:pointer;margin-top:20px;transition:background .2s}
button:hover{background:#4752c4}
.error{background:#3d1f1f;border:1px solid #6b2f2f;color:#f87171;border-radius:8px;padding:10px 14px;font-size:13px;margin-bottom:16px}
</style></head><body>
<div class="card">
  <div class="logo"><h1>🏆 LARP Bot</h1><p>Dashboard Login</p></div>
  ${req.query.error ? '<div class="error">Incorrect password</div>' : ''}
  <form method="POST" action="/login">
    <div style="margin-bottom:16px"><label>Password</label><input type="password" name="password" autofocus placeholder="Enter password"></div>
    <button type="submit">Sign In</button>
  </form>
</div></body></html>`);
});

app.post("/login", (req, res) => {
  if (req.body.password === PASSWORD) { req.session.authed = true; res.redirect("/"); }
  else res.redirect("/login?error=1");
});

app.get("/logout", (req, res) => { req.session.destroy(); res.redirect("/login"); });

// -------------------- MAIN DASHBOARD --------------------
app.get("/", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "dashboard.html"));
});

// -------------------- API --------------------
app.get("/api/status", requireAuth, (req, res) => res.json({ running: !!botProcess }));
app.post("/api/bot/start", requireAuth, (req, res) => { startBot(); res.json({ ok: true }); });
app.post("/api/bot/stop", requireAuth, (req, res) => { stopBot(); res.json({ ok: true }); });
app.post("/api/bot/restart", requireAuth, (req, res) => {
  if (botProcess) { botProcess.removeAllListeners(); botProcess.kill("SIGKILL"); botProcess = null; addLog("🔴 Bot stopped for restart"); }
  setTimeout(() => { startBot(); addLog("♻️ Bot restarted"); }, 800);
  res.json({ ok: true });
});
app.get("/api/logs", requireAuth, (req, res) => res.json({ logs }));
app.post("/api/logs/clear", requireAuth, (req, res) => { logs = []; res.json({ ok: true }); });

app.get("/api/responses", requireAuth, (req, res) => {
  try {
    const content = fs.readFileSync(path.join(__dirname, "responses.js"), "utf8");
    const match = content.match(/module\.exports\s*=\s*\[([\s\S]*?)\];/);
    if (!match) return res.json({ responses: [] });
    const responses = match[1].split("\n").map(l => l.trim().replace(/^["']|["'],?$/g, "")).filter(l => l.length > 0);
    res.json({ responses });
  } catch (e) { res.json({ responses: [] }); }
});

app.post("/api/responses", requireAuth, (req, res) => {
  try {
    const { responses } = req.body;
    const content = `module.exports = [\n${responses.map(r => `  ${JSON.stringify(r)}`).join(",\n")}\n];\n`;
    fs.writeFileSync(path.join(__dirname, "responses.js"), content, "utf8");
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/chance", requireAuth, (req, res) => {
  try {
    const file = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
    const match = file.match(/RANDOM_REPLY_CHANCE\s*=\s*([\d.]+)/);
    res.json({ chance: match ? parseFloat(match[1]) : 0.05 });
  } catch (e) { res.json({ chance: 0.05 }); }
});

app.post("/api/chance", requireAuth, (req, res) => {
  try {
    const { chance } = req.body;
    let file = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
    file = file.replace(/RANDOM_REPLY_CHANCE\s*=\s*[\d.]+/, `RANDOM_REPLY_CHANCE = ${chance}`);
    fs.writeFileSync(path.join(__dirname, "index.js"), file, "utf8");
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Booster endpoints
app.get("/api/booster", requireAuth, async (req, res) => {
  try {
    const active = await dbAll(`SELECT * FROM booster_roles`);
    const whitelist = await dbAll(`SELECT * FROM booster_whitelist`);
    const blacklist = await dbAll(`SELECT * FROM booster_blacklist`);

    // Collect all unique user IDs and resolve usernames via Discord API
    const token = process.env.TOKEN;
    const allIds = [...new Set([
      ...active.map(r => r.userId),
      ...whitelist.map(r => r.userId),
      ...blacklist.map(r => r.userId),
      ...active.flatMap(r => JSON.parse(r.sharedWith || '[]'))
    ])];

    const names = {};
    await Promise.all(allIds.map(async id => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);
        const r = await fetch(`https://discord.com/api/v10/users/${id}`, {
          headers: { Authorization: `Bot ${token}` },
          signal: controller.signal
        });
        clearTimeout(timeout);
        const data = await r.json();
        if (data.username) names[id] = data.global_name || data.username;
      } catch {}
    }));

    res.json({ active, whitelist, blacklist, names });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/booster/whitelist", requireAuth, async (req, res) => {
  try {
    const { userId, note } = req.body;
    await dbRun(`INSERT OR REPLACE INTO booster_whitelist (userId, note) VALUES (?, ?)`, [userId, note || '']);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/booster/whitelist/:id", requireAuth, async (req, res) => {
  try {
    await dbRun(`DELETE FROM booster_whitelist WHERE userId = ?`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/booster/blacklist", requireAuth, async (req, res) => {
  try {
    const { userId, note } = req.body;
    await dbRun(`INSERT OR REPLACE INTO booster_blacklist (userId, note) VALUES (?, ?)`, [userId, note || '']);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/booster/blacklist/:id", requireAuth, async (req, res) => {
  try {
    await dbRun(`DELETE FROM booster_blacklist WHERE userId = ?`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/booster/role/:userId", requireAuth, async (req, res) => {
  try {
    await dbRun(`DELETE FROM booster_roles WHERE userId = ?`, [req.params.userId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DM message endpoints
app.get("/api/dms", requireAuth, async (req, res) => {
  try {
    const rows = await dbAll(`SELECT key, value FROM dm_messages`);
    const result = {};
    rows.forEach(r => result[r.key] = r.value);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/dms", requireAuth, async (req, res) => {
  try {
    const { dm_boost_welcome, dm_boost_removed, dm_auto_reply } = req.body;
    await dbRun(`INSERT OR REPLACE INTO dm_messages (key, value) VALUES (?, ?)`, ['dm_boost_welcome', dm_boost_welcome]);
    await dbRun(`INSERT OR REPLACE INTO dm_messages (key, value) VALUES (?, ?)`, ['dm_boost_removed', dm_boost_removed]);
    await dbRun(`INSERT OR REPLACE INTO dm_messages (key, value) VALUES (?, ?)`, ['dm_auto_reply', dm_auto_reply]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Image-only channel endpoints
app.get("/api/imagemod", requireAuth, async (req, res) => {
  try {
    const channels = await dbAll(`SELECT * FROM image_only_channels`);
    // Resolve channel names via Discord API if bot token available
    const token = process.env.TOKEN;
    const enriched = await Promise.all(channels.map(async ch => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);
        const r = await fetch(`https://discord.com/api/v10/channels/${ch.channelId}`, {
          headers: { Authorization: `Bot ${token}` },
          signal: controller.signal
        });
        clearTimeout(timeout);
        const data = await r.json();
        return { ...ch, name: data.name || null };
      } catch { return { ...ch, name: null }; }
    }));
    res.json({ channels: enriched });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/imagemod", requireAuth, async (req, res) => {
  try {
    const { channelId, label } = req.body;
    await dbRun(`INSERT OR REPLACE INTO image_only_channels (channelId, label) VALUES (?, ?)`, [channelId, label || '']);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/imagemod/:channelId", requireAuth, async (req, res) => {
  try {
    await dbRun(`DELETE FROM image_only_channels WHERE channelId = ?`, [req.params.channelId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Send manual DM
app.post("/api/dm/send", requireAuth, async (req, res) => {
  try {
    const { userId, message } = req.body;
    if (!userId || !message) return res.status(400).json({ error: "Missing userId or message" });
    const token = process.env.TOKEN;
    // Open a DM channel with the user
    const dmRes = await fetch(`https://discord.com/api/v10/users/@me/channels`, {
      method: "POST",
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ recipient_id: userId })
    });
    if (!dmRes.ok) throw new Error(`Failed to open DM channel: ${dmRes.status}`);
    const dmChannel = await dmRes.json();
    // Send the message
    const msgRes = await fetch(`https://discord.com/api/v10/channels/${dmChannel.id}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ content: message })
    });
    if (!msgRes.ok) {
      const err = await msgRes.json();
      throw new Error(err.message || `Send failed: ${msgRes.status}`);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// -------------------- DM INBOX API --------------------
app.get("/api/inbox", requireAuth, async (req, res) => {
  try {
    const messages = await dbAll(`SELECT * FROM dm_inbox ORDER BY timestamp DESC LIMIT 100`);
    res.json({ messages });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/inbox/:id/read", requireAuth, async (req, res) => {
  try {
    await dbRun(`UPDATE dm_inbox SET read = 1 WHERE id = ?`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/inbox/read-all", requireAuth, async (req, res) => {
  try {
    await dbRun(`UPDATE dm_inbox SET read = 1`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/inbox/:id", requireAuth, async (req, res) => {
  try {
    await dbRun(`DELETE FROM dm_inbox WHERE id = ?`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// -------------------- MOD SETTINGS API --------------------
app.get("/api/mod/settings", requireAuth, async (req, res) => {
  try {
    const rows = await dbAll(`SELECT key, value FROM mod_settings`);
    const result = {};
    rows.forEach(r => result[r.key] = r.value);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/mod/settings", requireAuth, async (req, res) => {
  try {
    for (const [key, value] of Object.entries(req.body)) {
      await dbRun(`INSERT OR REPLACE INTO mod_settings (key, value) VALUES (?, ?)`, [key, String(value)]);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// -------------------- BAN API --------------------
app.post("/api/mod/ban", requireAuth, async (req, res) => {
  try {
    const { userIds, reason = "Banned via dashboard" } = req.body;
    if (!userIds?.length) return res.status(400).json({ error: "No user IDs" });
    const token = process.env.TOKEN;
    const guildId = process.env.GUILD_ID;
    if (!guildId) return res.status(500).json({ error: "GUILD_ID not set in .env" });

    const results = await Promise.all(userIds.map(async userId => {
      try {
        const r = await fetch(`https://discord.com/api/v10/guilds/${guildId}/bans/${userId}`, {
          method: "PUT",
          headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ delete_message_seconds: 7 * 24 * 60 * 60, reason })
        });
        if (!r.ok) {
          const err = await r.json();
          return { userId, ok: false, error: err.message || `HTTP ${r.status}` };
        }
        await dbRun(
          `INSERT OR REPLACE INTO mod_banned (userId, username, reason, bannedAt) VALUES (?, ?, ?, ?)`,
          [userId, userId, reason, Date.now()]
        );
        return { userId, ok: true };
      } catch (e) {
        return { userId, ok: false, error: e.message };
      }
    }));
    res.json({ results });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/mod/unban/:userId", requireAuth, async (req, res) => {
  try {
    const token = process.env.TOKEN;
    const guildId = process.env.GUILD_ID;
    const r = await fetch(`https://discord.com/api/v10/guilds/${guildId}/bans/${req.params.userId}`, {
      method: "DELETE",
      headers: { Authorization: `Bot ${token}` }
    });
    if (!r.ok && r.status !== 404) {
      const err = await r.json();
      return res.status(500).json({ error: err.message });
    }
    await dbRun(`DELETE FROM mod_banned WHERE userId = ?`, [req.params.userId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/mod/bans", requireAuth, async (req, res) => {
  try {
    const bans = await dbAll(`SELECT * FROM mod_banned ORDER BY bannedAt DESC`);
    res.json({ bans });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// -------------------- RECENT JOINS API --------------------
app.get("/api/mod/recent-joins", requireAuth, async (req, res) => {
  try {
    const token = process.env.TOKEN;
    const guildId = process.env.GUILD_ID;
    if (!guildId) return res.status(500).json({ error: "GUILD_ID not set in .env" });

    const r = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/members?limit=50`,
      { headers: { Authorization: `Bot ${token}` } }
    );
    if (!r.ok) return res.status(500).json({ error: `Discord API ${r.status}` });
    const members = await r.json();

    const now = Date.now();
    const result = members
      .filter(m => !m.user?.bot)
      .map(m => ({
        userId: m.user.id,
        username: m.user.global_name || m.user.username,
        joinedAt: new Date(m.joined_at).getTime(),
        accountAgeDays: Math.floor((now - new Date(m.user.id / 4194304 + 1420070400000).getTime()) / (1000 * 60 * 60 * 24))
      }))
      .sort((a, b) => b.joinedAt - a.joinedAt)
      .slice(0, 30);

    res.json({ members: result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => console.log(`Dashboard running at http://localhost:${PORT}`));
