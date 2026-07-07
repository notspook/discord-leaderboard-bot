const db = require("./database");

// Ensure table exists
db.run(`
  CREATE TABLE IF NOT EXISTS image_only_channels (
    channelId TEXT PRIMARY KEY,
    label TEXT DEFAULT ''
  )
`, () => {});

const ALLOWED_ROLE_ID = "1488342640557555795"; // main user role

function getImageOnlyChannels() {
  return new Promise(res =>
    db.all(`SELECT * FROM image_only_channels`, [], (e, r) => res(r || []))
  );
}

function isImageOnlyChannel(channelId) {
  return new Promise(res =>
    db.get(`SELECT channelId FROM image_only_channels WHERE channelId = ?`, [channelId], (e, r) => res(!!r))
  );
}

async function handleImageOnly(msg) {
  if (!msg.guild) return;
  if (msg.author.bot) return;

  const inImageChannel = await isImageOnlyChannel(msg.channel.id);
  if (!inImageChannel) return false;

  // Admins are exempt
  if (msg.member?.permissions.has("Administrator")) return false;

  // Check if message has an image/embed/attachment
  const hasImage = msg.attachments.some(a =>
    a.contentType?.startsWith("image/") || a.contentType?.startsWith("video/")
  );
  const hasEmbed = msg.embeds.some(e => e.image || e.thumbnail || e.video || e.type === "image" || e.type === "gifv" || e.type === "video");

  if (hasImage || hasEmbed) return false; // all good, message is fine

  // Delete the message silently
  await msg.delete().catch(() => {});

  // Send ephemeral-style warning — button to dismiss
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("dismiss_warning")
      .setLabel("Got it")
      .setStyle(ButtonStyle.Secondary)
  );

  const warning = await msg.channel.send({
    content: `<@${msg.author.id}> 🚫 **Images only in this channel.**\nTo chat freely, head to <#1488342643938295942>.`,
    components: [row]
  }).catch(() => null);

  // Auto-delete warning after 8 seconds even if not dismissed
  if (warning) setTimeout(() => warning.delete().catch(() => {}), 8000);
  return true; // message was deleted
}

// Handle the dismiss button
async function handleImageOnlyInteraction(interaction) {
  if (!interaction.isButton()) return false;
  if (interaction.customId !== "dismiss_warning") return false;
  await interaction.message.delete().catch(() => {});
  return true;
}

module.exports = { handleImageOnly, handleImageOnlyInteraction, getImageOnlyChannels, isImageOnlyChannel };
