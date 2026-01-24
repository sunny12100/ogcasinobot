const { EmbedBuilder } = require("discord.js");
const User = require("../models/User"); // Import Mongoose model
const { logToAudit } = require("../utils/logger");

module.exports = {
  name: "remove-gold",
  async execute(interaction) {
    const target = interaction.options.getUser("user");
    const amount = interaction.options.getInteger("amount");

    // 1. FETCH TARGET USER FROM MONGODB
    const userData = await User.findOne({ userId: target.id });

    // ERROR THROW: Check if user exists in the cloud DB
    if (!userData) {
      return interaction.reply({
        content: `❌ **Error:** Cannot remove gold. <@${target.id}> does not have a registered casino account.`,
        ephemeral: true,
      });
    }

    // 2. CALCULATE REMOVAL (Preventing negative balance)
    const oldBalance = userData.gold;
    userData.gold = Math.max(0, userData.gold - amount);
    const actualRemoved = oldBalance - userData.gold;

    // 3. SAVE UPDATED BALANCE TO ATLAS
    await userData.save();

    // 4. LOG TO AUDIT
    await logToAudit(interaction.client, {
      userId: target.id,
      adminId: interaction.user.id,
      amount: -actualRemoved,
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
