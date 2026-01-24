const { EmbedBuilder } = require("discord.js");

/**
 * Sends a formatted log to the Audit Channel
 */
async function logToAudit(client, data) {
  try {
    const auditChannelId = process.env.AUDIT_CHANNEL_ID;

    // 🟢 DEBUG 1: Is the function starting?
    console.log(`[LOGGER] 📡 Starting log for user: ${data.userId}`);
    console.log(`[LOGGER] 🆔 Channel ID from .env: ${auditChannelId}`);

    if (!auditChannelId) {
      console.error(
        "[LOGGER] ❌ CRITICAL: AUDIT_CHANNEL_ID is missing from .env!",
      );
      return;
    }

    // Force a fresh fetch from the Discord API instead of relying on cache
    const channel = await client.channels.fetch(auditChannelId).catch((err) => {
      console.error(`[LOGGER] ❌ Discord API Error: ${err.message}`);
      return null;
    });

    if (!channel) {
      console.error(
        "[LOGGER] ❌ Channel not found. Ensure the Bot is in the server and the ID is correct.",
      );
      return;
    }

    // 🟢 DEBUG 2: Did we find the channel?
    console.log(`[LOGGER] ✅ Channel Found: #${channel.name}`);

    const embedColor = data.amount >= 0 ? 0x2ecc71 : 0xe74c3c;
    const sign = data.amount >= 0 ? "+" : "";

    const embed = new EmbedBuilder()
      .setAuthor({
        name: "Transaction Log",
        iconURL: "https://i.imgur.com/8f1fXpB.png",
      })
      .setColor(embedColor)
      .addFields(
        { name: "👤 Target User", value: `<@${data.userId}>`, inline: true },
        {
          name: data.adminId ? "👮 Actioned By" : "🎮 Source",
          value: data.adminId ? `<@${data.adminId}>` : `Game System`,
          inline: true,
        },
        {
          name: "💰 Amount Changed",
          value: `\`${sign}${data.amount.toLocaleString()}\` gold`,
          inline: true,
        },
        { name: "📝 Reason", value: data.reason || "No reason provided" },
      )
      .setTimestamp();

    await channel.send({ embeds: [embed] });
    console.log(`[LOGGER] 🚀 Log successfully sent to Discord!`);
  } catch (error) {
    console.error("[LOGGER] ❌ Unexpected Error in logger.js:", error);
  }
}

module.exports = { logToAudit };
