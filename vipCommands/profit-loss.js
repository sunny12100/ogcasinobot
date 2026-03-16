const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const PassUser = require("../models/PassUser");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("profit-loss")
    .setDescription("📊 View your total practice gains and losses"),

  async execute(interaction) {
    const LOUNGE_ROLE = "1483219208962834473";

    if (!interaction.member.roles.cache.has(LOUNGE_ROLE)) {
      return interaction.reply({
        content: "🚫 Dashboard restricted to lounge members.",
        ephemeral: true,
      });
    }

    // Upsert here too so new users see their 1M balance immediately
    const stats = await PassUser.findOneAndUpdate(
      { userId: interaction.user.id },
      { $setOnInsert: { userId: interaction.user.id } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    const won = stats.totalWon || 0;
    const lost = stats.totalLost || 0;
    const net = won - lost;
    const isGreen = net >= 0;

    const embed = new EmbedBuilder()
      .setTitle(`🎰 Performance: ${interaction.user.username}`)
      .setColor(isGreen ? 0x2ecc71 : 0xe74c3c)
      .setThumbnail(interaction.user.displayAvatarURL())
      .addFields(
        {
          name: "🏦 Lounge Balance",
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
          name: "🎮 Games Played",
          value: `\`${stats.gamesPlayed}\``,
          inline: true,
        },
        {
          name: "🔥 Total Volume",
          value: `\`${(stats.totalWagered || 0).toLocaleString()}\``,
          inline: true,
        },
      )
      .setFooter({ text: "Lounge stats are separate from main account gold." })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  },
};
