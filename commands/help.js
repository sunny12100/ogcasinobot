const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("View the casino guide and game payouts"),

  async execute(interaction) {
    console.log("✅ /help command triggered");

    const helpEmbed = new EmbedBuilder()
      .setTitle("🏛️ OG CASINO COMMAND LIST")
      .setColor(0x5865f2)
      .setThumbnail(interaction.client.user.displayAvatarURL())
      .setDescription(
        "Welcome to **OG Casino**! Below is the complete list of commands and games.",
      )
      .addFields(
        {
          name: "🎮 PLAYER COMMANDS",
          value:
            "`/balance` – Check your gold balance\n" +
            "`/leaderboard` – Top 10 Casino Players\n" +
            "`/pay` – Send gold to another player\n" +
            "**🎰 GAMES (Bet Limits: 50–500)**\n" +
            "`/slots`\n" +
            "`/roulette`\n" +
            "`/coinflip`\n" +
            "`/blackjack`\n" +
            "`/aviator`\n" +
            "`/dice`\n" +
            "`/highlow`\n" +
            "`/horserace`\n" +
            "`/scratch`\n" +
            "`/poker`\n" +
            "`/rps`– PvP between two players",
        },
        {
          name: "👮 ADMIN COMMANDS (Staff Only)",
          value:
            "`/setup` – Create system panels\n" +
            "`/add-gold` – Give gold to a user\n" +
            "`/remove-gold` – Take gold from a user\n" +
            "`/stats` – Casino economy statistics",
        },
      )
      .setFooter({ text: "OG Casino • Use /[command] [amount] to play!" })
      .setTimestamp();

    await interaction.reply({
      embeds: [helpEmbed],
      ephemeral: true,
    });
  },
};

// Add this for older index.js loaders:
module.exports.name = "help";
