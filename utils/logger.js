const { EmbedBuilder, PermissionsBitField } = require("discord.js");

async function logToAudit(client, data) {
  try {
    const auditChannelId = process.env.AUDIT_CHANNEL_ID;
    if (!auditChannelId)
      return console.error("[LOGGER] AUDIT_CHANNEL_ID missing in .env");

    // 1. IMPROVED FETCH: Try cache, then force fetch if cache fails
    let channel = client.channels.cache.get(auditChannelId);
    if (!channel) {
      channel = await client.channels.fetch(auditChannelId).catch(() => null);
    }

    if (!channel)
      return console.error(`[LOGGER] Channel ${auditChannelId} not found.`);

    // 2. PERMISSION CHECK: Ensure the bot can actually speak there
    const botMember =
      channel.guild.members.me ||
      (await channel.guild.members.fetch(client.user.id));
    if (
      !channel
        .permissionsFor(botMember)
        .has(PermissionsBitField.Flags.SendMessages)
    ) {
      return console.error(
        "[LOGGER] Missing 'Send Messages' permission in audit channel.",
      );
    }

    // 3. DATA SANITIZATION: Ensure 0 doesn't trigger "No context"
    const netAmount = Number(data.amount) || 0;
    const isGain = netAmount >= 0;
    const embedColor = isGain ? 0x2ecc71 : 0xe74c3c;
    const statusEmoji = isGain ? "📈" : "📉";
    const gameName = data.reason ? data.reason.split(":")[0] : "Game Outcome";

    const embed = new EmbedBuilder()
      .setAuthor({
        name: `Transaction: ${gameName}`,
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
            `> **Wager:** \`${(data.bet ?? 0).toLocaleString()}\` gold\n` +
            `> **Net Change:** \`${isGain ? "+" : ""}${netAmount.toLocaleString()}\` gold\n` +
            `> **Type:** ${data.adminId ? "🛠️ Admin Override" : "🎮 Game Outcome"}`,
        },
        {
          name: "🏦 Balance Snapshot",
          value: `\`${(data.oldBalance ?? 0).toLocaleString()}\` → \`${(data.newBalance ?? 0).toLocaleString()}\``,
          inline: true,
        },
        {
          name: "📝 Full Context",
          value: `\`\`\`${data.reason || "No context provided"}\`\`\``,
        },
      )
      .setTimestamp();

    // 4. CRITICAL: Await the send
    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error("[LOGGER] ❌ Error in logToAudit:", error);
  }
}

module.exports = { logToAudit };
