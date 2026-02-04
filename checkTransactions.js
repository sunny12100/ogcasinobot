const { EmbedBuilder } = require("discord.js");
const User = require("./models/User");

function startTracking(client) {
  // Use a slightly longer interval (e.g., 45s) to avoid spamming the TTIO logs
  setInterval(async () => {
    try {
      const response = await fetch("https://territorial.io/log/transactions");
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

        // 1. Find the user by their TTIO ID (Case Insensitive)
        const userData = await User.findOne({
          ttio: { $regex: new RegExp(`^${sender}$`, "i") },
        });

        if (userData) {
          // 2. Check the high-water mark (timestamp check)
          // Make sure this matches the field names in your index.js modal submit
          const mark = userData.latest_tx_time || 0;

          if (txTime > mark) {
            // 3. ATOMIC UPDATE (This prevents duplicate/lost gold)
            // We update the DB directly and then use the result
            const updatedUser = await User.findOneAndUpdate(
              { userId: userData.userId },
              {
                $inc: { gold: amount },
                $set: { latest_tx_time: txTime, verified: true },
              },
              { new: true }, // Returns the document AFTER the update
            );

            // --- 1. NOTIFY THE PLAYER (DM) ---
            const depositEmbed = new EmbedBuilder()
              .setTitle("💰 Deposit Confirmed")
              .setColor(0x2ecc71)
              .setDescription(
                `We've detected your transfer of **${amount.toLocaleString()}** gold on the game logs!`,
              )
              .addFields(
                {
                  name: "📥 Amount Received",
                  value: `+${amount.toLocaleString()} gold`,
                  inline: true,
                },
                {
                  name: "🏦 Updated Balance",
                  value: `**${updatedUser.gold.toLocaleString()} gold**`,
                  inline: true,
                },
              )
              .setFooter({ text: "Thank you for topping up!" })
              .setTimestamp();

            const targetUser = await client.users
              .fetch(userData.userId)
              .catch(() => null);
            if (targetUser) {
              await targetUser
                .send({ embeds: [depositEmbed] })
                .catch(() => null);
            }

            // --- 2. NOTIFY THE ADMINS (LOG CHANNEL) ---
            if (logChannel) {
              const adminAlertEmbed = new EmbedBuilder()
                .setTitle("📥 NEW DEPOSIT DETECTED")
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
                    value: `**${amount.toLocaleString()}** Gold`,
                    inline: true,
                  },
                  {
                    name: "📊 New Balance",
                    value: `${updatedUser.gold.toLocaleString()}`,
                    inline: true,
                  },
                )
                .setFooter({ text: `TX Time: ${txTime}` })
                .setTimestamp();

              logChannel.send({ embeds: [adminAlertEmbed] });
            }
          }
        }
      }
    } catch (err) {
      console.error("Tracker Error:", err);
    }
  }, 45000);
}

module.exports = { startTracking };
