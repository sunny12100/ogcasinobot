const { EmbedBuilder } = require("discord.js");

/**
 * Sends a formatted log to the Audit Channel
 * @param {Object} client - The Discord Client
 * @param {Object} data - { userId, amount, reason, staffId (optional) }
 */
async function logToAudit(client, data) {
  const auditChannelId = process.env.AUDIT_CHANNEL_ID;
  const channel = client.channels.cache.get(auditChannelId);

  if (!channel) {
    return console.error(
      "❌ Audit Channel not found. Check your AUDIT_CHANNEL_ID in .env",
    );
  }

  // Green for profit (+), Red for loss (-)
  const embedColor = data.amount >= 0 ? 0x2ecc71 : 0xe74c3c;

  const embed = new EmbedBuilder()
    .setAuthor({
      name: "Balance updated",
      iconURL: "https://i.imgur.com/8f1fXpB.png",
    })
    .setColor(embedColor)
    .setDescription(
      `**User:** <@${data.userId}>\n` +
        (data.staffId ? `**Actioned by:** <@${data.staffId}>\n` : "") +
        `**Amount:** Cash: ${data.amount >= 0 ? "+" : ""}${data.amount.toLocaleString()} | Bank: 0\n` +
        `**Reason:** ${data.reason}`,
    )
    .setTimestamp();

  await channel.send({ embeds: [embed] });
}

module.exports = { logToAudit };
