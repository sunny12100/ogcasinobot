const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const PassUser = require("../models/PassUser");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("profit-loss")
    .setDescription("📊 View your total gains and losses in the lounge"),

  async execute(interaction) {
    const LOUNGE_CHANNEL = "1483219995834974382";
    const LOUNGE_ROLE = "1483219208962834473";

    // Security Check
    if (
      interaction.channel.name !== LOUNGE_CHANNEL ||
      !interaction.member.roles.cache.has(LOUNGE_ROLE)
    ) {
      return interaction.reply({
        content:
          "🚫 This dashboard is only available to members in the **#games-vip** lounge.",
        ephemeral: true,
      });
    }

    const stats = await PassUser.findOne({ userId: interaction.user.id });

    if (!stats || stats.gamesPlayed === 0) {
      return interaction.reply({
        content:
          "❌ No data found. Play a game in the lounge first to start tracking your performance!",
        ephemeral: true,
      });
    }

    const won = stats.totalWon || 0;
    const lost = stats.totalLost || 0;
    const net = won - lost;
    const isGreen = net >= 0;

    const embed = new EmbedBuilder()
      .setTitle(`🎰 Performance Review: ${interaction.user.username}`)
      .setColor(isGreen ? 0x2ecc71 : 0xe74c3c)
      .setThumbnail(interaction.user.displayAvatarURL())
      .addFields(
        {
          name: "🏦 Current Balance",
          value: `\`${stats.passBalance.toLocaleString()}\` Gold`,
          inline: false,
        },
        {
          name: "📈 Total Won",
          value: `\`${won.toLocaleString()}\``,
          inline: true,
        },
        {
          name: "📉 Total Lost",
          value: `\`${lost.toLocaleString()}\``,
          inline: true,
        },
        {
          name: isGreen ? "✅ Net Profit" : "🔻 Net Loss",
          value: `**${isGreen ? "+" : ""}${net.toLocaleString()}** Gold`,
          inline: true,
        },
        {
          name: "🎮 Total Games",
          value: `\`${stats.gamesPlayed}\``,
          inline: true,
        },
        {
          name: "🔥 Wager Volume",
          value: `\`${(stats.totalWagered || 0).toLocaleString()}\``,
          inline: true,
        },
      )
      .setFooter({ text: "Lounge stats are separate from main account gold." })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  },
};
