const { EmbedBuilder } = require("discord.js");
const User = require("../models/User"); // Import your Mongoose model
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
    userData.gold += amount;
    await userData.save();

    // 3. LOG TO AUDIT (Passing adminId for tracking)
    await logToAudit(interaction.client, {
      userId: target.id,
      adminId: interaction.user.id,
      amount: amount,
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
