const { EmbedBuilder } = require("discord.js");
const { loadUsers } = require("../utils/db");

module.exports = {
  name: "balance",
  async execute(interaction) {
    // 1. Get the target user (if provided), otherwise use the command runner
    const targetUser = interaction.options.getUser("user") || interaction.user;
    const users = loadUsers();
    const userData = users[targetUser.id];

    // 2. Verification Check
    if (!userData) {
      return interaction.reply({
        content: `❌ **${targetUser.username}** is not a registered member of the OG Casino.`,
        ephemeral: false, // Set to false so everyone sees the error/shame
      });
    }

    // 3. Calculate Rank
    // Convert the users object to an array, sort by balance descending
    const leaderboard = Object.entries(users)
      .map(([id, data]) => ({ id, balance: data.balance }))
      .sort((a, b) => b.balance - a.balance);

    const rankIndex = leaderboard.findIndex((u) => u.id === targetUser.id) + 1;

    // 4. Create the Public Embed
    const embed = new EmbedBuilder()
      .setTitle(`💰 VAULT: ${targetUser.username.toUpperCase()}`)
      .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
      .setColor(rankIndex === 1 ? 0xffd700 : 0x5865f2) // Gold color for #1
      .addFields(
        {
          name: "💵 Current Balance",
          value: `\`${userData.balance.toLocaleString()}\` Gold`,
          inline: true,
        },
        {
          name: "🏆 Global Rank",
          value: `#${rankIndex} of ${leaderboard.length}`,
          inline: true,
        },
      )
      .setDescription(
        rankIndex === 1
          ? "👑 **The current King of the Casino!**"
          : `Keep playing to climb the leaderboard.`,
      )
      .setFooter({ text: "OG Casino • Public Ledger" })
      .setTimestamp();

    // 5. Public Reply
    await interaction.reply({ embeds: [embed] });
  },
};
