const { EmbedBuilder } = require("discord.js");

/**
 * Sends a detailed transaction log to the Audit Channel
 */
async function logToAudit(client, data) {
  try {
    const auditChannelId = process.env.AUDIT_CHANNEL_ID;

    if (!auditChannelId) {
      console.error(
        "[LOGGER] ❌ CRITICAL: AUDIT_CHANNEL_ID is missing from .env!",
      );
      return;
    }

    const channel = await client.channels
      .fetch(auditChannelId)
      .catch(() => null);
    if (!channel) return;

    const isGain = data.amount >= 0;
    const embedColor = isGain ? 0x2ecc71 : 0xe74c3c; // Green for win/add, Red for loss/remove
    const statusEmoji = isGain ? "📈" : "📉";

    const embed = new EmbedBuilder()
      .setAuthor({
        name: `Transaction: ${data.reason.split(":")[0]}`, // Pulls game name from reason
        iconURL: isGain
          ? "https://i.imgur.com/8f1fXpB.png"
          : "https://i.imgur.com/97S7F5G.png",
      })
      .setColor(embedColor)
      .setDescription(
        `### ${statusEmoji} Financial Update\n**User:** <@${data.userId}> (\`${data.userId}\`)`,
      )
      .addFields(
        {
          name: "💵 Transaction Details",
          value:
            `> **Wager:** \`${(data.bet || 0).toLocaleString()}\` gold\n` +
            `> **Net Change:** \`${isGain ? "+" : ""}${data.amount.toLocaleString()}\` gold\n` +
            `> **Type:** ${data.adminId ? "🛠️ Admin Override" : "🎮 Game Outcome"}`,
          inline: false,
        },
        {
          name: "🏦 Balance Snapshot",
          value: `\`${(data.oldBalance || 0).toLocaleString()}\` → \`${(data.newBalance || 0).toLocaleString()}\``,
          inline: true,
        },
        {
          name: "📝 Full Context",
          value: `\`\`\`${data.reason || "No context provided"}\`\`\``,
          inline: false,
        },
      )
      .setFooter({ text: `Server Time` })
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error("[LOGGER] ❌ Error in logger.js:", error);
  }
}

module.exports = { logToAudit };
