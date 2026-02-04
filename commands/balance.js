const { EmbedBuilder } = require("discord.js");
const User = require("../models/User"); // Import the Mongoose model

module.exports = {
  name: "balance",
  async execute(interaction) {
    // 1. Get the target user
    const targetUser = interaction.options.getUser("user") || interaction.user;

    // 2. Fetch User Data from MongoDB
    const userData = await User.findOne({ userId: targetUser.id });

    // 3. Verification Check
    if (!userData) {
      return interaction.reply({
        content: `❌ **${targetUser.username}** is not a registered member of the OG Casino.`,
        ephemeral: false,
      });
    }

    // 4. Calculate Rank & Stats efficiently
    // We count how many users have MORE gold than this user to find their rank
    const rankIndex =
      (await User.countDocuments({ gold: { $gt: userData.gold } })) + 1;
    const totalUsers = await User.countDocuments();

    // 5. Create the Embed
    const embed = new EmbedBuilder()
      .setTitle(`💰 VAULT: ${targetUser.username.toUpperCase()}`)
      .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
      .setColor(rankIndex === 1 ? 0xffd700 : 0x5865f2)
      .addFields(
        {
          name: "💵 Current Balance",
          value: `\`${userData.gold.toLocaleString()}\` Gold`,
          inline: true,
        },
        {
          name: "🏆 Global Rank",
          value: `#${rankIndex} of ${totalUsers}`,
          inline: true,
        },
        {
          name: "🎮 Linked ID",
          value: `\`${userData.ttio || "Not Linked"}\``,
          inline: false,
        },
      )
      .setDescription(
        rankIndex === 1
          ? "👑 **The current King of the Casino!**"
          : `Keep playing to climb the leaderboard.`,
      )
      .setFooter({ text: "OG Casino • Live Cloud Ledger" })
      .setTimestamp();

    // 6. Public Reply
    await interaction.reply({ embeds: [embed] });
  },
};
