const { EmbedBuilder } = require("discord.js");
const { loadUsers, saveUsers } = require("./utils/db");

function startTracking(client) {
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

      let users = loadUsers();
      let dataChanged = false;

      // Fetch the log channel once per interval
      const logChannelId = process.env.LOG_CHANNEL_ID;
      const logChannel = client.channels.cache.get(logChannelId);

      for (const line of lines) {
        const [timeStr, sender, receiver, amountStr] = line.split(",");
        if (receiver !== "XZZWE") continue;

        const txTime = parseInt(timeStr);
        const amount = parseFloat(amountStr);

        const discordId = Object.keys(users).find(
          (id) => users[id].ttio.toLowerCase() === sender.toLowerCase(),
        );

        if (discordId) {
          const user = users[discordId];
          const mark = user.latest_tx_time || user.registered_at || 0;

          if (txTime > mark) {
            user.balance += amount;
            user.verified = true;
            user.latest_tx_time = txTime;
            dataChanged = true;

            // --- 1. NOTIFY THE PLAYER (DM) ---
            const depositEmbed = new EmbedBuilder()
              .setTitle("💰 Deposit Confirmed")
              .setColor(0x2ecc71)
              .setDescription(
                `We've detected your transfer on the Territorial.io logs!`,
              )
              .addFields(
                {
                  name: "📥 Amount Received",
                  value: `+${amount.toLocaleString()} gold`,
                  inline: true,
                },
                {
                  name: "🏦 Updated Balance",
                  value: `**${user.balance.toLocaleString()} gold**`,
                  inline: true,
                },
              )
              .setFooter({ text: "Thank you for topping up!" })
              .setTimestamp();

            client.users
              .fetch(discordId)
              .then((u) => u.send({ embeds: [depositEmbed] }))
              .catch(() => console.log(`Could not DM user ${discordId}`));

            // --- 2. NOTIFY THE ADMINS (LOG CHANNEL) ---
            if (logChannel) {
              const adminAlertEmbed = new EmbedBuilder()
                .setTitle("📥 NEW DEPOSIT DETECTED")
                .setColor(0x2ecc71)
                .setThumbnail(
                  "https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExM2ppeDU1eXVxazEzNDU0ZGVycDJ3MnkyMm51empmMGF2OHE2YWthNyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/ZVr17jubM740M8tgkU/giphy.gif",
                ) // Optional: a money bag icon
                .addFields(
                  { name: "👤 User", value: `<@${discordId}>`, inline: true },
                  { name: "🎮 Game ID", value: `\`${sender}\``, inline: true },
                  {
                    name: "💰 Amount",
                    value: `**${amount.toLocaleString()}** Gold`,
                    inline: true,
                  },
                  {
                    name: "📊 New Balance",
                    value: `${user.balance.toLocaleString()}`,
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
      if (dataChanged) saveUsers(users);
    } catch (err) {
      console.error("Tracker Error:", err);
    }
  }, 30000);
}

module.exports = { startTracking };
