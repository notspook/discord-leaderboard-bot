const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags
} = require("discord.js");

const db = require("./database");

// DB setup — store booster roles
db.run(`
  CREATE TABLE IF NOT EXISTS booster_roles (
    userId TEXT PRIMARY KEY,
    roleId TEXT NOT NULL,
    sharedWith TEXT DEFAULT '[]'
  )
`, () => {});

// Named colors for user convenience
const COLOR_NAMES = {
  red: "#FF0000", crimson: "#DC143C", coral: "#FF6B6B",
  orange: "#FF8C00", gold: "#FFD700", yellow: "#FFFF00",
  lime: "#00FF00", green: "#008000", teal: "#008080",
  cyan: "#00FFFF", sky: "#87CEEB", blue: "#0000FF",
  navy: "#000080", indigo: "#4B0082", purple: "#800080",
  violet: "#EE82EE", pink: "#FF69B4", rose: "#FF007F",
  white: "#FFFFFF", silver: "#C0C0C0", gray: "#808080",
  black: "#000001" // Discord doesn't render true black so use near-black
};

function resolveColor(input) {
  if (!input) return null;
  const lower = input.toLowerCase().trim();
  if (COLOR_NAMES[lower]) return COLOR_NAMES[lower];
  const hex = lower.startsWith("#") ? lower : `#${lower}`;
  if (/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  return null;
}

function hexToInt(hex) {
  return parseInt(hex.replace("#", ""), 16);
}

function getBoosterRole(userId) {
  return new Promise(res =>
    db.get(`SELECT * FROM booster_roles WHERE userId = ?`, [userId], (e, r) => res(r || null))
  );
}

function isCurrentBooster(member) {
  return member.premiumSince !== null;
}

// -------------------- !boosterrole --------------------
async function isAllowed(member) {
  // Check blacklist first
  const bl = await new Promise(res => db.get(`SELECT userId FROM booster_blacklist WHERE userId = ?`, [member.id], (e, r) => res(r)));
  if (bl) return { allowed: false, reason: "blacklisted" };
  // Check whitelist
  const wl = await new Promise(res => db.get(`SELECT userId FROM booster_whitelist WHERE userId = ?`, [member.id], (e, r) => res(r)));
  if (wl) return { allowed: true, reason: "whitelisted" };
  // Check actual boost
  if (isCurrentBooster(member)) return { allowed: true, reason: "booster" };
  return { allowed: false, reason: "not_booster" };
}

async function getDMMessage(key) {
  return new Promise(res => db.get(`SELECT value FROM dm_messages WHERE key = ?`, [key], (e, r) => res(r?.value || null)));
}

async function handleBoosterRole(msg) {
  const member = msg.member;
  const guild = msg.guild;

  const { allowed } = await isAllowed(member);
  if (!allowed) {
    return msg.reply({
      content: "💎 This command is only available to **Server Boosters**. Boost the server to get your own custom role!",
      flags: MessageFlags.Ephemeral
    }).catch(() => msg.reply("💎 This command is only for Server Boosters."));
  }

  const existing = await getBoosterRole(member.id);

  const modal = new ModalBuilder()
    .setCustomId("booster_role_modal")
    .setTitle("✨ Customize Your Booster Role");

  const nameInput = new TextInputBuilder()
    .setCustomId("role_name")
    .setLabel("Role Name")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("e.g. The Goat, Shadow Council, Certified Baller")
    .setMaxLength(32)
    .setRequired(true);

  if (existing) {
    const currentRole = await guild.roles.fetch(existing.roleId).catch(() => null);
    if (currentRole) nameInput.setValue(currentRole.name);
  }

  const colorInput = new TextInputBuilder()
    .setCustomId("role_color")
    .setLabel("Color (name or hex code)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("e.g. crimson  OR  #ff6b6b  OR  purple")
    .setMaxLength(20)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(nameInput),
    new ActionRowBuilder().addComponents(colorInput)
  );

  // We need to show the modal from an interaction — trigger a button first
  const previewEmbed = new EmbedBuilder()
    .setTitle("✨ Booster Role Customizer")
    .setColor(0x5865f2)
    .setDescription(
      existing
        ? "You already have a custom role! Click below to update it."
        : "As a server booster you get your own custom role. Click below to set it up!"
    )
    .addFields(
      { name: "Role Name", value: "Any name up to 32 characters", inline: true },
      { name: "Color", value: "Named colors or hex codes\ne.g. `crimson`, `#ff6b6b`, `purple`", inline: true },
      { name: "Available Color Names", value: Object.keys(COLOR_NAMES).join(", ") }
    )
    .setFooter({ text: "Role sits at the bottom of the hierarchy — purely cosmetic ✨" });

  const btn = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("open_booster_modal")
      .setLabel(existing ? "✏️ Update My Role" : "✨ Create My Role")
      .setStyle(ButtonStyle.Primary)
  );

  if (existing) {
    const currentRole = await guild.roles.fetch(existing.roleId).catch(() => null);
    const shared = JSON.parse(existing.sharedWith || "[]");
    if (currentRole) {
      previewEmbed.addFields({
        name: "Your Current Role",
        value: `**${currentRole.name}** — Color: \`#${currentRole.color.toString(16).padStart(6, "0")}\`\nShared with: ${shared.length > 0 ? shared.map(id => `<@${id}>`).join(", ") : "nobody"}`
      });

      btn.components.push(
        new ButtonBuilder()
          .setCustomId("remove_booster_role")
          .setLabel("🗑 Remove Role")
          .setStyle(ButtonStyle.Danger)
      );
    }
  }

  await msg.reply({ embeds: [previewEmbed], components: [btn], flags: MessageFlags.Ephemeral })
    .catch(() => msg.reply({ embeds: [previewEmbed], components: [btn] }));
}

// -------------------- !sharerole --------------------
async function handleShareRole(msg) {
  const member = msg.member;
  const guild = msg.guild;

  if (!isCurrentBooster(member)) {
    return msg.reply("💎 Only Server Boosters can use this command.");
  }

  const existing = await getBoosterRole(member.id);
  if (!existing) {
    return msg.reply("You don't have a custom role yet. Use `!boosterrole` to create one first.");
  }

  const mentions = msg.mentions.members;
  if (!mentions || mentions.size === 0) {
    return msg.reply("Usage: `!sharerole @user1 @user2 @user3` — share your role with up to 3 people.");
  }

  if (mentions.size > 3) {
    return msg.reply("You can only share your role with up to **3 people**.");
  }

  const role = await guild.roles.fetch(existing.roleId).catch(() => null);
  if (!role) {
    return msg.reply("Your custom role seems to have been deleted. Use `!boosterrole` to recreate it.");
  }

  const currentShared = JSON.parse(existing.sharedWith || "[]");
  const newShared = [...new Set([...mentions.keys()])].slice(0, 3);

  // Remove role from anyone who was previously shared but isn't anymore
  for (const oldId of currentShared) {
    if (!newShared.includes(oldId)) {
      const oldMember = await guild.members.fetch(oldId).catch(() => null);
      if (oldMember) await oldMember.roles.remove(role).catch(() => {});
    }
  }

  // Add role to new shares
  for (const newId of newShared) {
    const newMember = await guild.members.fetch(newId).catch(() => null);
    if (newMember) await newMember.roles.add(role).catch(() => {});
  }

  db.run(`UPDATE booster_roles SET sharedWith = ? WHERE userId = ?`,
    [JSON.stringify(newShared), member.id]);

  const names = newShared.map(id => `<@${id}>`).join(", ");
  await msg.reply(`✅ Your role **${role.name}** is now shared with: ${names}`);
}

// -------------------- INTERACTION HANDLER --------------------
async function handleBoosterInteraction(interaction) {
  const guild = interaction.guild;
  const member = interaction.member;

  // Open modal button
  if (interaction.isButton() && interaction.customId === "open_booster_modal") {
    const { allowed } = await isAllowed(member);
    if (!allowed) {
      return interaction.reply({ content: "You are no longer eligible for a booster role.", flags: MessageFlags.Ephemeral });
    }

    const existing = await getBoosterRole(member.id);
    const modal = new ModalBuilder()
      .setCustomId("booster_role_modal")
      .setTitle("✨ Customize Your Booster Role");

    const nameInput = new TextInputBuilder()
      .setCustomId("role_name")
      .setLabel("Role Name")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("e.g. The Goat, Shadow Council, Certified Baller")
      .setMaxLength(32)
      .setRequired(true);

    if (existing) {
      const currentRole = await guild.roles.fetch(existing.roleId).catch(() => null);
      if (currentRole) nameInput.setValue(currentRole.name);
    }

    const colorInput = new TextInputBuilder()
      .setCustomId("role_color")
      .setLabel("Color — name (crimson) or hex (#ff6b6b)")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("e.g.  purple  OR  #ff6b6b  OR  gold")
      .setMaxLength(20)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(nameInput),
      new ActionRowBuilder().addComponents(colorInput)
    );

    return interaction.showModal(modal);
  }

  // Remove role button
  if (interaction.isButton() && interaction.customId === "remove_booster_role") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const existing = await getBoosterRole(member.id);
    if (!existing) return interaction.editReply("No custom role found.");

    const role = await guild.roles.fetch(existing.roleId).catch(() => null);
    if (role) await role.delete().catch(() => {});

    db.run(`DELETE FROM booster_roles WHERE userId = ?`, [member.id]);
    return interaction.editReply("🗑 Your custom role has been removed.");
  }

  // Modal submit
  if (interaction.isModalSubmit() && interaction.customId === "booster_role_modal") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const rawName = interaction.fields.getTextInputValue("role_name").trim();
    const rawColor = interaction.fields.getTextInputValue("role_color").trim();

    const hex = resolveColor(rawColor);
    if (!hex) {
      return interaction.editReply(
        `❌ **"${rawColor}"** isn't a valid color.\nUse a color name like \`crimson\`, \`purple\`, \`gold\` or a hex code like \`#ff6b6b\`.\n\nAvailable names: ${Object.keys(COLOR_NAMES).join(", ")}`
      );
    }

    const colorInt = hexToInt(hex);
    const existing = await getBoosterRole(member.id);

    if (existing) {
      // Update existing role
      const role = await guild.roles.fetch(existing.roleId).catch(() => null);
      if (role) {
        await role.edit({ name: rawName, color: colorInt }).catch(e => console.error("Role edit failed:", e.message));
        return interaction.editReply({
          embeds: [new EmbedBuilder()
            .setTitle("✅ Role Updated!")
            .setColor(colorInt)
            .setDescription(`Your role has been updated to **${rawName}**`)
            .addFields({ name: "Color", value: `${rawColor} → \`${hex}\`` })
          ]
        });
      }
    }

    // Create new role at the bottom of the hierarchy
    const newRole = await guild.roles.create({
      name: rawName,
      color: colorInt,
      permissions: [],
      reason: `Custom booster role for ${member.user.tag}`
    }).catch(e => { console.error("Role create failed:", e.message); return null; });

    if (!newRole) return interaction.editReply("❌ Failed to create role. Make sure the bot has Manage Roles permission.");

    // Move it to the bottom (position 1, just above @everyone)
    await newRole.setPosition(1).catch(() => {});

    // Give it to the member
    await member.roles.add(newRole).catch(e => console.error("Add booster role failed:", e.message));

    // Save to DB
    db.run(`INSERT OR REPLACE INTO booster_roles (userId, roleId, sharedWith) VALUES (?, ?, '[]')`,
      [member.id, newRole.id]);

    return interaction.editReply({
      embeds: [new EmbedBuilder()
        .setTitle("✨ Booster Role Created!")
        .setColor(colorInt)
        .setDescription(`Your custom role **${rawName}** has been created and added to your profile!`)
        .addFields(
          { name: "Color", value: `\`${hex}\``, inline: true },
          { name: "Share it", value: "Use `!sharerole @user` to share with up to 3 people", inline: true }
        )
        .setFooter({ text: "You can update it anytime with !boosterrole" })
      ]
    });
  }
}

// -------------------- BOOST REMOVED --------------------
async function handleBoostRemoved(oldMember, newMember) {
  // Was boosting before, not boosting now
  if (oldMember.premiumSince && !newMember.premiumSince) {
    const existing = await getBoosterRole(newMember.id);
    if (!existing) return;

    const guild = newMember.guild;

    // Remove role from shared members
    const shared = JSON.parse(existing.sharedWith || "[]");
    const role = await guild.roles.fetch(existing.roleId).catch(() => null);

    if (role) {
      for (const sharedId of shared) {
        const sharedMember = await guild.members.fetch(sharedId).catch(() => null);
        if (sharedMember) await sharedMember.roles.remove(role).catch(() => {});
      }
      await role.delete().catch(() => {});
    }

    db.run(`DELETE FROM booster_roles WHERE userId = ?`, [newMember.id]);

    // DM the user
    const removedMsg = await getDMMessage('dm_boost_removed') || "💔 Your server boost has ended so your custom role has been removed.\nIf you boost again, use `!boosterrole` to recreate it anytime!";
    newMember.send(removedMsg).catch(() => {});

    console.log(`✅ Removed booster role for ${newMember.id} (boost ended)`);
  }

  // Just started boosting — send welcome DM
  if (!oldMember.premiumSince && newMember.premiumSince) {
    newMember.send(
      "🎉 **Thanks for boosting the server!**\n\n" +
      "As a booster perk you get your own **custom role** — name it whatever you want and pick any color.\n\n" +
      "**Here's how to use it:**\n" +
      "`!boosterrole` — create or update your custom role\n" +
      "`!sharerole @user1 @user2 @user3` — share your role with up to 3 people\n\n" +
      "The role is purely cosmetic (no extra permissions) and sits at the bottom of the role list.\n" +
      "If you ever stop boosting, the role will be automatically removed. 💎"
    ).catch(() => {});
  }
}

module.exports = { handleBoosterRole, handleShareRole, handleBoosterInteraction, handleBoostRemoved };
