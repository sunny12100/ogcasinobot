const { EmbedBuilder } = require("discord.js");
const User = require("../models/User");
const AuditLog = require("../models/AuditLog"); // Added AuditLog
const { logToAudit } = require("../utils/logger");

module.exports = {
  name: "remove-gold",
  async execute(interaction) {
    const target = interaction.options.getUser("user");
    const amount = interaction.options.getInteger("amount");

    // 1. FETCH TARGET USER
    const userData = await User.findOne({ userId: target.id });

    if (!userData) {
      return interaction.reply({
        content: `❌ **Error:** <@${target.id}> does not have a registered account.`,
        ephemeral: true,
      });
    }

    // 2. CALCULATE REMOVAL
    const oldBalance = userData.gold;
    userData.gold = Math.max(0, userData.gold - amount);
    const actualRemoved = oldBalance - userData.gold;

    // 3. SAVE TO DB
    await userData.save();

    // 4. TRACK MODERATOR ACTION (For mod-stats)
    await AuditLog.create({
      modId: interaction.user.id,
      modTag: interaction.user.tag,
      targetId: target.id,
      action: "REMOVE",
      amount: actualRemoved, // Tracking the positive volume removed
      timestamp: new Date(),
    }).catch((err) => console.error("❌ AuditLog Save Error (Remove):", err));

    // 5. LOG TO AUDIT CHANNEL
    await logToAudit(interaction.client, {
      userId: target.id,
      adminId: interaction.user.id,
      amount: -actualRemoved,
      oldBalance: oldBalance,
      newBalance: userData.gold,
      reason: "Admin remove-gold command",
    });

    const embed = new EmbedBuilder()
      .setTitle("💸 GOLD VOIDED")
      .setColor(0xe74c3c)
      .setThumbnail(target.displayAvatarURL())
      .setDescription(`Successfully updated the vaults for ${target}.`)
      .addFields(
        {
          name: "Amount Removed",
          value: `\`${actualRemoved.toLocaleString()}\` gold`,
          inline: true,
        },
        {
          name: "Current Balance",
          value: `\`${userData.gold.toLocaleString()}\` gold`,
          inline: true,
        },
      )
      .setFooter({ text: "Admin Action Logged" })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
