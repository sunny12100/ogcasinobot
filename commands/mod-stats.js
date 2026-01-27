const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} = require("discord.js");
const AuditLog = require("../models/AuditLog");

module.exports = {
  name: "mod-stats",
  async execute(interaction) {
    if (
      !interaction.member.permissions.has(PermissionFlagsBits.Administrator)
    ) {
      return interaction.reply({
        content: "❌ Restricted to Admins.",
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    const logs = await AuditLog.find().sort({ timestamp: -1 });

    if (logs.length === 0) {
      return interaction.editReply("📊 No activity logs found.");
    }

    const itemsPerPage = 10;
    let currentPage = 0;
    const totalPages = Math.ceil(logs.length / itemsPerPage);

    const generateEmbed = (page) => {
      const start = page * itemsPerPage;
      const end = start + itemsPerPage;
      const currentLogs = logs.slice(start, end);

      const embed = new EmbedBuilder()
        .setTitle("📑 MODERATOR ACTION LOGS")
        .setColor(0x34495e)
        .setFooter({
          text: `Page ${page + 1} of ${totalPages} | Total Logs: ${logs.length}`,
        })
        .setTimestamp();

      let description = "";
      currentLogs.forEach((log) => {
        const time = `<t:${Math.floor(log.timestamp.getTime() / 1000)}:R>`;
        const actionEmoji = log.action === "ADD" ? "🟢" : "🔴";

        description +=
          `${actionEmoji} **${log.modTag}** ${log.action === "ADD" ? "added" : "removed"} ` +
          `**${log.amount.toLocaleString()}** to/from <@${log.targetId}>\n` +
          `└ ${time}\n\n`;
      });

      embed.setDescription(description || "No logs on this page.");
      return embed;
    };

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("prev_page")
        .setLabel("Previous")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId("next_page")
        .setLabel("Next")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(totalPages <= 1),
    );

    const message = await interaction.editReply({
      embeds: [generateEmbed(0)],
      components: [row],
    });

    // --- BUTTON COLLECTOR ---
    const collector = message.createMessageComponentCollector({
      filter: (i) => i.user.id === interaction.user.id,
      time: 60000, // Collector lasts 1 minute
    });

    collector.on("collect", async (i) => {
      if (i.customId === "next_page") currentPage++;
      if (i.customId === "prev_page") currentPage--;

      const newRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("prev_page")
          .setLabel("Previous")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(currentPage === 0),
        new ButtonBuilder()
          .setCustomId("next_page")
          .setLabel("Next")
          .setStyle(ButtonStyle.Primary)
          .setDisabled(currentPage === totalPages - 1),
      );

      await i.update({
        embeds: [generateEmbed(currentPage)],
        components: [newRow],
      });
    });

    collector.on("end", () => {
      const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("p")
          .setLabel("Previous")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId("n")
          .setLabel("Next")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
      );
      interaction.editReply({ components: [disabledRow] }).catch(() => null);
    });
  },
};
