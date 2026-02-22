const { EmbedBuilder } = require("discord.js");
const User = require("./models/User");

function startTracking(client) {
  // Check every 45s
  setInterval(async () => {
    try {
      // ADDED HEADERS: This tells the server you are a "browser" not a bot
      const response = await fetch("https://territorial.io/log/transactions", {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(10000), // Don't hang longer than 10s
      });

      if (!response.ok) return; // Silent skip if server is busy

      const text = await response.text();
      const lines = text
        .replace(/<[^>]*>/g, "")
        .trim()
        .split("\n")
        .slice(1)
        .reverse();

      const logChannelId = process.env.LOG_CHANNEL_ID;
      const logChannel =
        client.channels.cache.get(logChannelId) ||
        (await client.channels.fetch(logChannelId).catch(() => null));

      for (const line of lines) {
        const [timeStr, sender, receiver, amountStr] = line.split(",");
        if (receiver !== "AWwh_") continue;

        const txTime = parseInt(timeStr);
        const amount = parseFloat(amountStr);

        const userData = await User.findOne({
          ttio: { $regex: new RegExp(`^${sender}$`, "i") },
        });

        if (userData) {
          const mark = userData.latest_tx_time || 0;

          if (txTime > mark) {
            const updatedUser = await User.findOneAndUpdate(
              { userId: userData.userId },
              {
                $inc: { gold: amount },
                $set: { latest_tx_time: txTime, verified: true },
              },
              { new: true },
            );

            // --- NOTIFY PLAYER ---
            const targetUser = await client.users
              .fetch(userData.userId)
              .catch(() => null);
            if (targetUser) {
              const depositEmbed = new EmbedBuilder()
                .setTitle("💰 Deposit Confirmed")
                .setColor(0x2ecc71)
                .setDescription(
                  `Detected transfer of **${amount.toLocaleString()}** gold!`,
                )
                .addFields(
                  {
                    name: "📥 Received",
                    value: `+${amount.toLocaleString()}`,
                    inline: true,
                  },
                  {
                    name: "🏦 Balance",
                    value: `**${updatedUser.gold.toLocaleString()}**`,
                    inline: true,
                  },
                )
                .setTimestamp();
              await targetUser
                .send({ embeds: [depositEmbed] })
                .catch(() => null);
            }

            // --- LOG TO ADMIN ---
            if (logChannel) {
              const adminAlertEmbed = new EmbedBuilder()
                .setTitle("📥 NEW DEPOSIT")
                .setColor(0x2ecc71)
                .addFields(
                  {
                    name: "👤 User",
                    value: `<@${userData.userId}>`,
                    inline: true,
                  },
                  { name: "🎮 Game ID", value: `\`${sender}\``, inline: true },
                  {
                    name: "💰 Amount",
                    value: `${amount.toLocaleString()}`,
                    inline: true,
                  },
                  {
                    name: "🏦 New Balance",
                    value: `**${updatedUser.gold.toLocaleString()}**`,
                    inline: true,
                  },
                )
                .setTimestamp();
              logChannel.send({ embeds: [adminAlertEmbed] });
            }
          }
        }
      }
    } catch (err) {
      // This handles the "Socket closed" error gracefully
      if (err.name === "TimeoutError" || err.code === "UND_ERR_SOCKET") {
        console.log(
          "🌐 Game Server connection dropped/timed out. Retrying in 45s...",
        );
      } else {
        console.error("Tracker Error:", err);
      }
    }
  }, 45000);
}

module.exports = { startTracking };
