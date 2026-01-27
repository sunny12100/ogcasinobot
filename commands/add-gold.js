const { EmbedBuilder } = require("discord.js");
const User = require("../models/User"); // Player model
const AuditLog = require("../models/AuditLog"); // New AuditLog model
const { logToAudit } = require("../utils/logger");

module.exports = {
  name: "add-gold",
  async execute(interaction) {
    const target = interaction.options.getUser("user");
    const amount = interaction.options.getInteger("amount");

    // 1. FETCH TARGET USER FROM MONGODB
    const userData = await User.findOne({ userId: target.id });

    // ERROR THROW: Check if user is registered in the database
    if (!userData) {
      return interaction.reply({
        content: `❌ **Error:** <@${target.id}> is not a registered user. They must register in the casino-lobby before you can add gold to their account.`,
        ephemeral: true,
      });
    }

    // 2. UPDATE GOLD AND SAVE
    const oldBalance = userData.gold;
    userData.gold += amount;
    await userData.save();

    // 3. TRACK MODERATOR ACTION (For mod-stats command)
    await AuditLog.create({
      modId: interaction.user.id,
      modTag: interaction.user.tag,
      targetId: target.id,
      action: "ADD",
      amount: amount,
      timestamp: new Date(),
    }).catch((err) => console.error("❌ AuditLog Save Error:", err));

    // 4. LOG TO AUDIT CHANNEL (Live feed)
    await logToAudit(interaction.client, {
      userId: target.id,
      adminId: interaction.user.id,
      amount: amount,
      oldBalance: oldBalance,
      newBalance: userData.gold,
      reason: "Admin add-gold command",
    });

    const embed = new EmbedBuilder()
      .setTitle("💰 GOLD GRANTED")
      .setColor(0x2ecc71)
      .setThumbnail(target.displayAvatarURL())
      .setDescription(
        `Successfully added **${amount.toLocaleString()}** gold to ${target}.`,
      )
      .addFields({
        name: "New Balance",
        value: `\`${userData.gold.toLocaleString()}\` gold`,
        inline: true,
      })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
