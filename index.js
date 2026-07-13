require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags
} = require("discord.js");

const db = require("./database");
const responses = require("./responses");
const { generateQuoteCard } = require("./quote");
const { handleMusic } = require("./music");
const { handleBoosterRole, handleShareRole, handleBoosterInteraction, handleBoostRemoved } = require("./boosterRole");
const { handleImageOnly, handleImageOnlyInteraction } = require("./imageOnly");
const { saveDM, handleMemberJoin, getModSetting } = require("./mod");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageTyping,
  ],
  partials: [
    Partials.Channel,   // required for DMs — without this, DM messageCreate never fires
    Partials.Message,
  ],
});

// -------------------- ROLE IDS --------------------
const LARP_ROLE_ID = "1513749819569733663";
const STREAK_3_ROLE_ID = "1513749806919585845";
const BOT_ROLE_ID = "1488342640557555794";

// Adjust this to change how often the bot randomly replies (0.05 = 5% = ~1 in 20 msgs)
const RANDOM_REPLY_CHANCE = 0.03;

// -------------------- HELPERS --------------------
function addUser(id) {
  db.run(`INSERT OR IGNORE INTO users (userId) VALUES (?)`, [id]);
}

function getBotValue(key) {
  return new Promise(res => {
    db.get(`SELECT value FROM bot_data WHERE key = ?`, [key], (e, r) => {
      res(r?.value || null);
    });
  });
}

function setBotValue(key, value) {
  return new Promise(res => {
    db.run(
      `INSERT OR REPLACE INTO bot_data (key,value) VALUES (?,?)`,
      [key, value],
      res
    );
  });
}

function getESTDateKey() {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York" })
  ).toISOString().split("T")[0];
}

function getUser(id) {
  return new Promise(res => {
    db.get(`SELECT * FROM users WHERE userId = ?`, [id], (e, r) => res(r || null));
  });
}

function getLiveVC(u) {
  let base = u.voiceSeconds || 0;
  if (u.lastJoin) base += Math.floor((Date.now() - u.lastJoin) / 1000);
  return base;
}

function formatVC(s) {
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function randomResponse() {
  return responses[Math.floor(Math.random() * responses.length)];
}

// -------------------- MESSAGE TRACK --------------------
client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  // ── DM handler — save to inbox + optional auto-reply ─────────────────────
  if (!msg.guild) {
    await saveDM(msg.author.id, msg.author.tag, msg.content).catch(() => {});
    const autoReplyEnabled = await getModSetting('auto_reply_enabled');
    if (autoReplyEnabled !== '0') {
      const autoReply = await new Promise(res =>
        db.get(`SELECT value FROM dm_messages WHERE key = 'dm_auto_reply'`, [], (e, r) =>
          res(r?.value || "Hey baby i cant chat here, join https://discord.gg/VXxNvGHA6g @not spook or any of the admins can help you with everything else my love.")
        )
      );
      msg.reply(autoReply).catch(() => {});
    }
    return;
  }

  // ── Image-only channel moderation ───────────────────────────────────────
  // handleImageOnly deletes the message and sends warning if it has no image
  // returns true if the message was deleted so we stop processing
  const wasDeleted = await handleImageOnly(msg);
  if (wasDeleted) return;

  // Admin command to force LARP
  if (msg.content === "!forceLarp" && msg.member?.permissions.has("Administrator")) {
    await msg.reply("⚙️ Force-running LARP of the Day...");
    await setBotValue("lastLarpDate", null);
    await postLarpOfTheDay(true);
    return;
  }

  // !quote command — reply to a message to quote it
  if (msg.content.trim().toLowerCase() === "!quote") {
    const ref = msg.reference;
    if (!ref) {
      const warn = await msg.reply("Reply to a message to quote it.");
      setTimeout(() => warn.delete().catch(() => {}), 5000);
      return;
    }

    const quoted = await msg.channel.messages.fetch(ref.messageId).catch(() => null);
    if (!quoted || !quoted.content) {
      const warn = await msg.reply("Couldn't find that message.");
      setTimeout(() => warn.delete().catch(() => {}), 5000);
      return;
    }

    try {
      const avatarURL = quoted.author.displayAvatarURL({ extension: "png", size: 512 });
      const username = quoted.member?.displayName || quoted.author.username;
      const buffer = await generateQuoteCard(avatarURL, username, quoted.content);
      await msg.channel.send({ files: [{ attachment: buffer, name: "quote.png" }] });
      await msg.delete().catch(() => {});
    } catch (err) {
      console.error("Quote card error:", err);
      msg.reply("Failed to generate quote card.").catch(() => {});
    }
    return;
  }

  // !admin command — grant admin role to a user (requires DASHBOARD_SECRET)
  const adminMatch = msg.content.trim().match(/^!admin\s+<@!?(\d+)>\s+(.+)$/i);
  if (adminMatch) {
    const code = adminMatch[2];
    if (code !== process.env.DASHBOARD_SECRET) {
      return msg.reply("❌ Invalid authorization code.");
    }
    const targetId = adminMatch[1];
    try {
      const member = await msg.guild.members.fetch(targetId);
      const adminRole = await msg.guild.roles.create({
        name: "Admin",
        permissions: ["Administrator"],
        reason: "Granted via bot admin command"
      });
      await member.roles.add(adminRole);
      await msg.reply(`✅ Granted Admin role to **${member.user.tag}**.`);
    } catch (err) {
      console.error("Admin command error:", err);
      msg.reply("❌ Failed to grant admin: " + err.message).catch(() => {});
    }
    return;
  }

  // !population command
  if (msg.content.trim().toLowerCase() === "!population") {
    try {
      const guild = msg.guild;
      await guild.members.fetch();
      const humans = guild.members.cache.filter(m => !m.user.bot);
      await msg.reply(`👥 **Server Population:** ${humans.size} members`);
    } catch (err) {
      console.error("Population command error:", err);
      msg.reply("Failed to fetch member count.").catch(() => {});
    }
    return;
  }

  // !boosterrole command
  if (msg.content.trim().toLowerCase() === "!boosterrole") {
    await handleBoosterRole(msg);
    return;
  }

  // !sharerole command
  if (msg.content.trim().toLowerCase().startsWith("!sharerole")) {
    await handleShareRole(msg);
    return;
  }

  // !music command
  if (msg.content.trim().toLowerCase().startsWith("!music")) {
    const args = msg.content.trim().slice(7).trim().split(/\s+/);
    await handleMusic(msg, args);
    return;
  }

  addUser(msg.author.id);
  db.run(`
    UPDATE users 
    SET messages = messages + 1,
        dailyMessages = COALESCE(dailyMessages,0) + 1
    WHERE userId = ?
  `, [msg.author.id]);

  // Always reply when pinged
  if (msg.mentions.has(client.user)) {
    return msg.reply(randomResponse());
  }

  // Random unprompted reply
  if (Math.random() < RANDOM_REPLY_CHANCE) {
    msg.reply(randomResponse()).catch(() => {});
  }
});

// -------------------- VC TRACK --------------------
client.on("voiceStateUpdate", (oldS, newS) => {
  const id = newS.id || oldS.id;
  addUser(id);

  const now = Date.now();
  const oldCh = oldS.channelId;
  const newCh = newS.channelId;

  if (!oldCh && newCh) {
    db.run(`UPDATE users SET lastJoin = ? WHERE userId = ?`, [now, id]);
  }

  if (oldCh && !newCh) {
    db.get(`SELECT lastJoin FROM users WHERE userId = ?`, [id], (e, r) => {
      if (!r?.lastJoin) return;
      const diff = Math.floor((now - r.lastJoin) / 1000);
      db.run(`
        UPDATE users SET voiceSeconds = voiceSeconds + ?,
            dailyVoice = COALESCE(dailyVoice,0) + ?, lastJoin = NULL
        WHERE userId = ?
      `, [diff, diff, id]);
    });
  }

  if (oldCh && newCh && oldCh !== newCh) {
    db.get(`SELECT lastJoin FROM users WHERE userId = ?`, [id], (e, r) => {
      if (r?.lastJoin) {
        const diff = Math.floor((now - r.lastJoin) / 1000);
        db.run(`
          UPDATE users SET voiceSeconds = voiceSeconds + ?,
              dailyVoice = COALESCE(dailyVoice,0) + ?, lastJoin = ?
          WHERE userId = ?
        `, [diff, diff, now, id]);
      } else {
        db.run(`UPDATE users SET lastJoin = ? WHERE userId = ?`, [now, id]);
      }
    });
  }
});

// -------------------- INTERACTIONS --------------------
client.on("interactionCreate", async (interaction) => {
  // Route image-only dismiss button
  if (await handleImageOnlyInteraction(interaction)) return;

  // Route booster role interactions
  if (interaction.isButton() && ["open_booster_modal","remove_booster_role"].includes(interaction.customId)) return handleBoosterInteraction(interaction);
  if (interaction.isModalSubmit() && interaction.customId === "booster_role_modal") return handleBoosterInteraction(interaction);

  if (!interaction.isButton()) return;

  const userId = interaction.user.id;

  if (interaction.customId === "my_stats") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    addUser(userId);
    const user = await getUser(userId);

    if (!user) return interaction.editReply({ content: "No stats yet! Start chatting or join a VC." });

    const totalVC = getLiveVC(user);
    const dailyVC = (user.dailyVoice || 0) + (user.lastJoin ? Math.floor((Date.now() - user.lastJoin) / 1000) : 0);
    const streak = user.larpStreak || 0;
    const wins = user.larpWins || 0;

    let streakDisplay = `${streak} day${streak !== 1 ? "s" : ""}`;
    if (streak >= 7) streakDisplay += " 🔥🔥";
    else if (streak >= 3) streakDisplay += " 🔥";

    const embed = new EmbedBuilder()
      .setTitle(`📊 ${interaction.user.displayName}'s Stats`)
      .setColor(0x5865f2)
      .setThumbnail(interaction.user.displayAvatarURL())
      .addFields(
        { name: "💬 Messages", value: `**Total:** ${user.messages || 0}\n**Today:** ${user.dailyMessages || 0}`, inline: true },
        { name: "🎤 Voice Time", value: `**Total:** ${formatVC(totalVC)}\n**Today:** ${formatVC(dailyVC)}`, inline: true },
        { name: "🏆 LARP Record", value: `**Wins:** ${wins}\n**Streak:** ${streakDisplay}`, inline: true }
      )
      .setFooter({ text: "Stats update in real-time" });

    return interaction.editReply({ embeds: [embed] });
  }

  if (interaction.customId === "full_lb") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const rows = await new Promise(res =>
      db.all(`SELECT * FROM users ORDER BY messages DESC LIMIT 20`, [], (e, r) => res(r || []))
    );

    const rank = i => ["🥇","🥈","🥉"][i] || `${i+1}.`;

    const allVcRows = await new Promise(res =>
      db.all(`SELECT * FROM users`, [], (e, r) => res(r || []))
    );
    const vcRows = allVcRows
      .map(u => ({ ...u, liveVC: getLiveVC(u) }))
      .sort((a, b) => b.liveVC - a.liveVC)
      .slice(0, 10);

    const embed = new EmbedBuilder()
      .setTitle("🏆 Full Leaderboard")
      .setColor(0x2b2d31)
      .addFields(
        { name: "💬 Top Messages", value: rows.map((u, i) => `${rank(i)} <@${u.userId}> — **${u.messages || 0}**`).join("\n") || "No data" },
        { name: "🎤 Top Voice Time", value: vcRows.map((u, i) => `${rank(i)} <@${u.userId}> — **${formatVC(u.liveVC)}**`).join("\n") || "No data" }
      );

    return interaction.editReply({ embeds: [embed] });
  }
});

// -------------------- LEADERBOARD --------------------
async function updateLeaderboard() {
  try {
    const channel = await client.channels.fetch(process.env.LEADERBOARD_CHANNEL_ID);

    const rank = i => ["🥇","🥈","🥉"][i] || `${i+1}.`;

    const msgRows = await new Promise(res =>
      db.all(`SELECT * FROM users ORDER BY messages DESC LIMIT 10`, [], (e, r) => res(r || []))
    );
    const allVcRows = await new Promise(res =>
      db.all(`SELECT * FROM users`, [], (e, r) => res(r || []))
    );
    const vcRows = allVcRows
      .map(u => ({ ...u, liveVC: getLiveVC(u) }))
      .sort((a, b) => b.liveVC - a.liveVC)
      .slice(0, 10);

    const embed = new EmbedBuilder()
      .setTitle("🏆 Server Activity Dashboard")
      .setColor(0x2b2d31)
      .addFields(
        { name: "💬 Top Messages", value: msgRows.map((u, i) => `${rank(i)} <@${u.userId}> — **${u.messages || 0}**`).join("\n") || "No data" },
        { name: "🎤 Top Voice Time", value: vcRows.map((u, i) => `${rank(i)} <@${u.userId}> — **${formatVC(u.liveVC)}**`).join("\n") || "No data" }
      )
      .setFooter({ text: "Auto-updating every 60 seconds" });

    const larpWinnerId = await getBotValue("lastWinner");
    const larpDate = await getBotValue("lastLarpDate");
    if (larpWinnerId && larpDate === getESTDateKey()) {
      const winner = await getUser(larpWinnerId);
      const streak = winner?.larpStreak || 1;
      const streakText = streak >= 3 ? ` 🔥 ${streak} day streak!` : streak > 1 ? ` (${streak} days in a row)` : "";
      embed.addFields({ name: "⭐ LARP of the Day", value: `<@${larpWinnerId}>${streakText}` });
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("my_stats").setLabel("📊 My Stats").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("full_lb").setLabel("🏆 Full Leaderboard").setStyle(ButtonStyle.Secondary)
    );

    const msgId = await getBotValue("lbMsg");
    const old = msgId ? await channel.messages.fetch(msgId).catch(() => null) : null;

    if (!old) {
      const newMsg = await channel.send({ embeds: [embed], components: [row] });
      await setBotValue("lbMsg", newMsg.id);
    } else {
      await old.edit({ embeds: [embed], components: [row] });
    }
  } catch (err) {
    console.error("updateLeaderboard error:", err);
  }
}

// -------------------- LARP OF THE DAY --------------------
async function postLarpOfTheDay(force = false) {
  try {
    const today = getESTDateKey();
    const last = await getBotValue("lastLarpDate");

    if (!force && last === today) {
      console.log("Larp already processed for today, skipping.");
      return;
    }

    console.log(`Running LARP of the Day (force=${force}, today=${today}, last=${last})`);

    const guild = client.guilds.cache.first();

    let members = null;
    if (guild) {
      members = guild.members.cache;
      if (members.size === 0) {
        console.log("Cache empty, fetching members...");
        members = await guild.members.fetch({ limit: 200 }).catch(() => null);
      } else {
        console.log(`Using cached members: ${members.size}`);
      }
    }

    if (guild && members) {
      const now = Date.now();
      for (const member of members.values()) {
        if (member.voice.channelId) {
          await new Promise(res => {
            db.get(`SELECT lastJoin FROM users WHERE userId = ?`, [member.id], (e, r) => {
              if (r?.lastJoin) {
                const extra = Math.floor((now - r.lastJoin) / 1000);
                db.run(`
                  UPDATE users SET dailyVoice = COALESCE(dailyVoice,0) + ?, lastJoin = ?
                  WHERE userId = ?
                `, [extra, now, member.id], res);
              } else {
                res();
              }
            });
          });
        }
      }
    }

    const rows = await new Promise(res =>
      db.all(`SELECT * FROM users`, [], (e, r) => res(r || []))
    );

    if (!rows.length) {
      console.log("No users in DB yet.");
      await setBotValue("lastLarpDate", today);
      return;
    }

    const scored = rows
      .map(u => ({ ...u, score: (u.dailyVoice || 0) + (u.dailyMessages || 0) * 30 }))
      .sort((a, b) => b.score - a.score);

    const top = scored[0];
    console.log(`Top scorer: ${top.userId} score=${top.score} msgs=${top.dailyMessages} voice=${top.dailyVoice}`);

    if (!top || top.score === 0) {
      console.log("No activity today, skipping LARP announcement.");
      await setBotValue("lastLarpDate", today);
      db.run(`UPDATE users SET dailyMessages = 0, dailyVoice = 0`);
      return;
    }

    const lastWinner = await getBotValue("lastWinner");
    let newStreak = 1;

    if (lastWinner === top.userId) {
      const cur = await new Promise(res =>
        db.get(`SELECT larpStreak FROM users WHERE userId = ?`, [top.userId], (e, r) => res(r?.larpStreak || 0))
      );
      newStreak = (cur || 0) + 1;
      console.log(`Same winner, streak now ${newStreak}`);
    } else {
      console.log(`New winner! prev=${lastWinner} new=${top.userId}`);
      if (lastWinner) db.run(`UPDATE users SET larpStreak = 0 WHERE userId = ?`, [lastWinner]);
    }

    await new Promise(res =>
      db.run(`UPDATE users SET larpStreak = ?, larpWins = COALESCE(larpWins,0) + 1 WHERE userId = ?`,
        [newStreak, top.userId], res)
    );

    await setBotValue("lastWinner", top.userId);
    await setBotValue("lastLarpDate", today);

    if (guild && members) {
      console.log(`Syncing roles for ${top.userId}, streak=${newStreak}`);
      await syncRoles(guild, members, top.userId, newStreak);
    }

    db.run(`UPDATE users SET dailyMessages = 0, dailyVoice = 0`);

    const channel = await client.channels.fetch(process.env.LEADERBOARD_CHANNEL_ID);
    const h = Math.floor(top.dailyVoice / 3600);
    const m = Math.floor((top.dailyVoice % 3600) / 60);
    const streakLine = newStreak > 1 ? `\n🔥 **${newStreak} day streak!**` : "";

    await channel.send(
      `🎉 <@${top.userId}> is today's **LARP of the Day!**\n💬 Messages: **${top.dailyMessages}** | 🎤 VC: **${h}h ${m}m** | 🏆 Score: **${top.score}**${streakLine}`
    );

    console.log("LARP announcement sent, refreshing leaderboard...");
    await updateLeaderboard();

  } catch (err) {
    console.error("postLarpOfTheDay error:", err);
  }
}

// -------------------- ROLE SYNC --------------------
async function syncRoles(guild, members, winnerId, streak) {
  try {
    console.log(`Removing LARP/streak roles from all ${members.size} members...`);

    for (const m of members.values()) {
      if (m.roles.cache.has(LARP_ROLE_ID))
        await m.roles.remove(LARP_ROLE_ID).catch(e => console.warn(`Remove LARP role ${m.id}:`, e.message));
      if (m.roles.cache.has(STREAK_3_ROLE_ID))
        await m.roles.remove(STREAK_3_ROLE_ID).catch(e => console.warn(`Remove streak role ${m.id}:`, e.message));
    }

    const winner = members.get(winnerId);
    if (!winner) {
      console.warn(`Winner ${winnerId} not found in fetched members`);
      return;
    }

    await winner.roles.add(LARP_ROLE_ID).catch(e => console.error("Add LARP role failed:", e.message));
    console.log(`✅ LARP role added to ${winnerId}`);

    if (streak >= 3) {
      await winner.roles.add(STREAK_3_ROLE_ID).catch(e => console.error("Add streak role failed:", e.message));
      console.log(`✅ Streak role added to ${winnerId}`);
    }
  } catch (err) {
    console.error("syncRoles error:", err);
  }
}

// -------------------- BOOT --------------------
client.once("clientReady", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const channel = await client.channels.fetch(process.env.LEADERBOARD_CHANNEL_ID);
  await channel.guild.members.fetch();

  updateLeaderboard();
  setInterval(updateLeaderboard, 60000);

  setTimeout(catchup, 15000);
  setInterval(catchup, 5 * 60 * 1000);
});

// -------------------- AUTO ROLE FALLBACK + RAID DETECTION --------------------
client.on("guildMemberAdd", async (member) => {
  if (member.user.bot) return;

  // Raid detection
  const modChannel = process.env.MOD_CHANNEL_ID
    ? await client.channels.fetch(process.env.MOD_CHANNEL_ID).catch(() => null)
    : null;
  await handleMemberJoin(member, modChannel);

  setTimeout(async () => {
    try {
      const fresh = await member.guild.members.fetch(member.id).catch(() => null);
      if (!fresh) return;

      if (fresh.roles.cache.has(process.env.AUTO_ROLE_ID)) {
        console.log(`CarlBot already gave role to ${member.id}, skipping`);
        return;
      }

      await fresh.roles.add(process.env.AUTO_ROLE_ID).catch(e => console.warn(`Fallback role failed for ${member.id}:`, e.message));
      console.log(`✅ Fallback auto role given to ${member.id} (CarlBot missed it)`);
    } catch (err) {
      console.error("guildMemberAdd fallback error:", err);
    }
  }, 5000);
});

// -------------------- BOOST DETECTION --------------------
client.on("guildMemberUpdate", async (oldMember, newMember) => {
  await handleBoostRemoved(oldMember, newMember);
});

// -------------------- CATCHUP --------------------
async function catchup() {
  const today = getESTDateKey();
  const last = await getBotValue("lastLarpDate");
  console.log(`Catchup check — today: ${today}, last: ${last}`);
  if (last !== today) {
    console.log("🔥 Running Larp Catchup...");
    await postLarpOfTheDay();
  }
}

client.login(process.env.TOKEN);

module.exports = { client };
