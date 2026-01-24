const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const User = require("../models/User"); // Import your Mongoose model

module.exports = {
  name: "leaderboard",
  async execute(interaction) {
    // 1. FETCH ALL USERS SORTED BY GOLD (DESCENDING)
    const allUsers = await User.find({}).sort({ gold: -1 });

    if (!allUsers || allUsers.length === 0) {
      return interaction.reply("The vault is empty! No one has any gold yet.");
    }

    const itemsPerPage = 10;
    const totalPages = Math.ceil(allUsers.length / itemsPerPage);
    let currentPage = 0;

    // Function to build the embed for a specific page
    const generateEmbed = (page) => {
      const start = page * itemsPerPage;
      const end = start + itemsPerPage;
      const currentItems = allUsers.slice(start, end);

      const leaderboardString = currentItems
        .map((user, index) => {
          const rank = start + index + 1;
          let medal = "";
          if (rank === 1) medal = "🥇 ";
          else if (rank === 2) medal = "🥈 ";
          else if (rank === 3) medal = "🥉 ";
          else medal = `\`#${rank}\` `;

          return `${medal} <@${user.userId}> — **${user.gold.toLocaleString()}** gold`;
        })
        .join("\n");

      // Find the interaction user's rank
      const userIndex = allUsers.findIndex(
        (u) => u.userId === interaction.user.id,
      );
      const userRankText = userIndex === -1 ? "Unranked" : `#${userIndex + 1}`;

      return new EmbedBuilder()
        .setTitle("🏆 THE HIGH-ROLLERS HALL OF FAME")
        .setColor(0xffd700)
        .setThumbnail(
          "https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExMG9ueHkzNTVyanVqb3NnODJhNnI5bjl1ZTlqMDhtcnpya2N4ZmwweCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/E2UlE5Of9zEjK/giphy.gif",
        )
        .setDescription(leaderboardString)
        .addFields({
          name: "Your Status",
          value: `Rank: **${userRankText}** | Page: **${page + 1} of ${totalPages}**`,
        })
        .setFooter({ text: `Total Players: ${allUsers.length}` })
        .setTimestamp();
    };

    // Create buttons row
    const getButtons = (page) => {
      return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("prev")
          .setLabel("◀ Previous")
          .setStyle(ButtonStyle.Primary)
          .setDisabled(page === 0),
        new ButtonBuilder()
          .setCustomId("next")
          .setLabel("Next ▶")
          .setStyle(ButtonStyle.Primary)
          .setDisabled(page === totalPages - 1),
      );
    };

    const response = await interaction.reply({
      embeds: [generateEmbed(currentPage)],
      components: [getButtons(currentPage)],
      fetchReply: true,
    });

    // Create collector for button interaction
    const collector = response.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 60000,
    });

    collector.on("collect", async (i) => {
      if (i.user.id !== interaction.user.id) {
        return i.reply({
          content: "Run the command yourself to navigate!",
          ephemeral: true,
        });
      }

      if (i.customId === "next") currentPage++;
      else if (i.customId === "prev") currentPage--;

      await i.update({
        embeds: [generateEmbed(currentPage)],
        components: [getButtons(currentPage)],
      });
    });

    collector.on("end", () => {
      interaction.editReply({ components: [] }).catch(() => null);
    });
  },
};
