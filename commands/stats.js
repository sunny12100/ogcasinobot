const { EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const User = require("../models/User"); // Your Mongoose model

module.exports = {
  name: "stats",
  async execute(interaction) {
    // 1. ADMIN CHECK
    if (
      !interaction.member.permissions.has(PermissionFlagsBits.Administrator)
    ) {
      return interaction.reply({
        content: "❌ Restricted to Administrators.",
        ephemeral: true,
      });
    }

    // 2. FETCH ALL USERS (Sorted for Median)
    const allUsers = await User.find({}).sort({ gold: 1 });
    const totalUsers = allUsers.length;

    if (totalUsers === 0) {
      return interaction.reply("📊 No registered users found in the database.");
    }

    // 3. AGGREGATE STATS
    const STARTING_GOLD = 500;
    let totalGold = 0;
    let brokeCount = 0; // < 100
    let mediumCount = 0; // 100 - 1,000
    let eliteCount = 0; // 1,001 - 10,000
    let richCount = 0; // > 10,000

    const balances = allUsers.map((u) => {
      const bal = u.gold;
      totalGold += bal;

      // Categorize
      if (bal < 100) brokeCount++;
      else if (bal <= 1000) mediumCount++;
      else if (bal <= 10000) eliteCount++;
      else richCount++;

      return bal;
    });

    // 4. CALCULATIONS
    const avgBalance = Math.floor(totalGold / totalUsers);
    const totalInjected = totalUsers * STARTING_GOLD;
    const netHouseProfit = totalInjected - totalGold;
    const richest = allUsers[totalUsers - 1]; // Last element due to sort

    // Median Logic
    const median =
      totalUsers % 2 === 0
        ? (balances[totalUsers / 2 - 1] + balances[totalUsers / 2]) / 2
        : balances[Math.floor(totalUsers / 2)];

    const statsEmbed = new EmbedBuilder()
      .setTitle("🏛️ OG CASINO DASHBOARD")
      .setColor(0x00ffcc)
      .setThumbnail(
        "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExbnI2Z254b3dzNjhzemtnZndiZDBqcmxhZGtxaHIzdmhoMXU1cXp3dSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/GWS8bXKxphfEI/giphy.gif",
      )
      .setDescription(
        `**Economy Overview (Cloud Mode)**\n` +
          `The House has a net profit/loss of \`${netHouseProfit.toLocaleString()}\` gold relative to starting balances.`,
      )
      .addFields(
        {
          name: "💰 MONETARY SUPPLY",
          value: `**Total Gold:** \`${totalGold.toLocaleString()}\`\n**Avg Balance:** \`${avgBalance.toLocaleString()}\`\n**Median:** \`${median.toLocaleString()}\``,
          inline: false,
        },
        {
          name: "📊 WEALTH DISTRIBUTION",
          value:
            `📉 **Broke (<100):** \`${brokeCount}\`\n` +
            `⚖️ **Medium (100-1k):** \`${mediumCount}\`\n` +
            `💎 **Elite (1k-10k):** \`${eliteCount}\`\n` +
            `👑 **Rich (10k+):** \`${richCount}\``,
          inline: true,
        },
        {
          name: "🐳 TOP WHALE",
          value: richest
            ? `<@${richest.userId}>\nBalance: \`${richest.gold.toLocaleString()}\``
            : "None",
          inline: true,
        },
      )
      .setFooter({ text: `Global Scan: ${totalUsers} Active Wallets` })
      .setTimestamp();

    await interaction.reply({ embeds: [statsEmbed] });
  },
};
