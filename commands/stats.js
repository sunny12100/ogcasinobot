const { EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const User = require("../models/User");

module.exports = {
  name: "stats",
  async execute(interaction) {
    if (
      !interaction.member.permissions.has(PermissionFlagsBits.Administrator)
    ) {
      return interaction.reply({
        content: "❌ Restricted to Administrators.",
        ephemeral: true,
      });
    }

    const allUsers = await User.find({}).sort({ gold: 1 });
    const totalUsers = allUsers.length;

    if (totalUsers === 0)
      return interaction.reply("📊 No registered users found.");

    const STARTING_GOLD = 500;
    let totalGold = 0;
    let tiers = { broke: 0, medium: 0, elite: 0, rich: 0 };

    const balances = allUsers.map((u) => {
      const bal = u.gold;
      totalGold += bal;

      if (bal < 100) tiers.broke++;
      else if (bal <= 1000) tiers.medium++;
      else if (bal <= 10000) tiers.elite++;
      else tiers.rich++;

      return bal;
    });

    const avgBalance = Math.floor(totalGold / totalUsers);
    const netHouseProfit = totalUsers * STARTING_GOLD - totalGold;
    const richest = allUsers[totalUsers - 1];

    const median =
      totalUsers % 2 === 0
        ? (balances[totalUsers / 2 - 1] + balances[totalUsers / 2]) / 2
        : balances[Math.floor(totalUsers / 2)];

    // Progress Bar Helper
    const createBar = (count) => {
      const segments = 10;
      const filled = Math.round((count / totalUsers) * segments);
      return "🟦".repeat(filled) + "⬜".repeat(segments - filled);
    };

    const statsEmbed = new EmbedBuilder()
      .setTitle("🏛️ CASINO ECONOMY COMMAND CENTER")
      .setColor(netHouseProfit >= 0 ? 0x2ecc71 : 0xe74c3c) // Green if House is winning, Red if losing
      .setThumbnail(
        "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExbnI2Z254b3dzNjhzemtnZndiZDBqcmxhZGtxaHIzdmhoMXU1cXp3dSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/GWS8bXKxphfEI/giphy.gif",
      )
      .setDescription(
        `### House Status: ${netHouseProfit >= 0 ? "📈 IN THE GREEN" : "📉 IN THE RED"}\n` +
          `The House has ${netHouseProfit >= 0 ? "drained" : "lost"} **${Math.abs(netHouseProfit).toLocaleString()}** gold from the initial player supply.`,
      )
      .addFields(
        {
          name: "💰 MONETARY METRICS",
          value:
            `\`\`\`js\n` +
            `Total Supply : ${totalGold.toLocaleString()}g\n` +
            `Avg Balance  : ${avgBalance.toLocaleString()}g\n` +
            `Median Val   : ${median.toLocaleString()}g\n` +
            `\`\`\``,
          inline: false,
        },
        {
          name: "📊 PLAYER CLASS DISTRIBUTION",
          value:
            `👑 **Rich:** \`${tiers.rich}\` users\n${createBar(tiers.rich)}\n` +
            `💎 **Elite:** \`${tiers.elite}\` users\n${createBar(tiers.elite)}\n` +
            `⚖️ **Mid:** \`${tiers.medium}\` users\n${createBar(tiers.medium)}\n` +
            `📉 **Broke:** \`${tiers.broke}\` users\n${createBar(tiers.broke)}`,
          inline: false,
        },
        {
          name: "🐳 TOP WHALE",
          value: richest
            ? `<@${richest.userId}>\n**${richest.gold.toLocaleString()}** gold`
            : "None",
          inline: true,
        },
        {
          name: "👥 POPULATION",
          value: `**${totalUsers}** Active Wallets`,
          inline: true,
        },
      )
      .setFooter({ text: "Economic health scan complete." })
      .setTimestamp();

    await interaction.reply({ embeds: [statsEmbed] });
  },
};
