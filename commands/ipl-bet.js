const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ipl-bet")
    .setDescription(
      "🔓 Get the IPL Betting role to unlock the betting channel",
    ),

  async execute(interaction) {
    const { member, guild } = interaction;

    // 🆔 Replace this with your actual "IPL Betting" Role ID
    const BETTING_ROLE_ID = "1494698638490865756";

    const role = guild.roles.cache.get(BETTING_ROLE_ID);

    if (!role) {
      return interaction.reply({
        content:
          "❌ Error: The betting role was not found in this server. Please check the ID in the code.",
        ephemeral: true,
      });
    }

    try {
      // Check if they already have it
      if (member.roles.cache.has(BETTING_ROLE_ID)) {
        return interaction.reply({
          content: "✅ You already have the IPL Betting role!",
          ephemeral: true,
        });
      }

      await member.roles.add(role);

      const embed = new EmbedBuilder()
        .setTitle("🏏 Access Granted")
        .setColor(0x2ecc71)
        .setDescription(
          "The **IPL Betting** role has been added to your profile.\n\nYou should now be able to see the betting channel!",
        )
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    } catch (error) {
      console.error(error);
      return interaction.reply({
        content:
          "❌ I don't have permission to give roles. Make sure my role is higher than the betting role in server settings!",
        ephemeral: true,
      });
    }
  },
};
