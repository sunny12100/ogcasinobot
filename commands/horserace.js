const { EmbedBuilder } = require("discord.js");
const User = require("../models/User");
const { logToAudit } = require("../utils/logger");

const activeRaces = new Set();

module.exports = {
  name: "horserace",
  async execute(interaction) {
    const amount = interaction.options.getInteger("amount");
    const chosenHorse = interaction.options.getString("horse");
    const userId = interaction.user.id;

    if (activeRaces.has(userId)) {
      return interaction.reply({
        content: "❌ You already have a race in progress!",
        ephemeral: true,
      });
    }

    activeRaces.add(userId);
    const failSafe = setTimeout(() => activeRaces.delete(userId), 90000);

    try {
      // 1. Get pre-game data for the audit snapshot
      const preGameUser = await User.findOne({ userId });
      if (!preGameUser || preGameUser.gold < amount) {
        activeRaces.delete(userId);
        clearTimeout(failSafe);
        return interaction.reply({
          content: "❌ Not enough gold!",
          ephemeral: true,
        });
      }

      const initialBalance = preGameUser.gold;

      // 2. Atomic deduction (Charge the user immediately)
      const userData = await User.findOneAndUpdate(
        { userId, gold: { $gte: amount } },
        { $inc: { gold: -amount } },
        { new: true },
      );

      if (!userData) {
        activeRaces.delete(userId);
        clearTimeout(failSafe);
        return interaction.reply({
          content: "❌ Transaction failed. Try again.",
          ephemeral: true,
        });
      }

      const horses = [
        { name: "OG", emoji: "🔴", pos: 0 },
        { name: "SYNDICATE", emoji: "🔵", pos: 0 },
        { name: "TITAN", emoji: "🟢", pos: 0 },
        { name: "IND", emoji: "🟡", pos: 0 },
      ];

      const finishLine = 15;
      const generateTrack = () => {
        let track = "```js\n";
        horses.forEach((h) => {
          const remaining = "▬".repeat(Math.max(0, finishLine - h.pos - 1));
          const progress = " ".repeat(h.pos);
          const icon = h.pos >= finishLine - 1 ? "🏁" : "🏇";
          track += `${h.emoji} | ${remaining}${icon}${progress} | ${h.name.padEnd(6)}\n`;
        });
        track += "```";
        return track;
      };

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("🏆 PREMIER CHAMPIONSHIP DERBY")
            .setColor(0x00aaff)
            .setDescription(
              `👤 **Bettor:** <@${userId}>\n💰 **Bet:** \`${amount.toLocaleString()}\` gold\n🏇 **Selected:** **${chosenHorse}**\n\n${generateTrack()}`,
            ),
        ],
      });

      const interval = setInterval(async () => {
        horses.forEach((h) => {
          const boost = Math.random();
          if (boost > 0.7) h.pos += 2;
          else if (boost > 0.4) h.pos += 1;
        });

        const finishers = horses.filter((h) => h.pos >= finishLine - 1);

        if (finishers.length > 0) {
          clearInterval(interval);
          clearTimeout(failSafe);
          activeRaces.delete(userId);

          const winner =
            finishers[Math.floor(Math.random() * finishers.length)];
          const won = winner.name === chosenHorse;
          const winnings = amount * 3;

          let finalUser;
          if (won) {
            // Give 2x back (Original bet + profit)
            finalUser = await User.findOneAndUpdate(
              { userId },
              { $inc: { gold: winnings } },
              { new: true },
            );
          } else {
            // Gold was already deducted, just get current state
            finalUser = await User.findOne({ userId });
          }

          // 🛠️ LOGIC FIX: Determine change by comparing final state to initial state
          const netChange = finalUser.gold - initialBalance;

          // 3. LOG TO AUDIT (Awaited for stability)
          await logToAudit(interaction.client, {
            userId,
            bet: amount,
            amount: netChange,
            oldBalance: initialBalance,
            newBalance: finalUser.gold,
            reason: `Horse Race: ${chosenHorse} (Winner: ${winner.name})`,
          }).catch(() => null);

          return interaction
            .editReply({
              embeds: [
                new EmbedBuilder()
                  .setTitle(won ? "🎉 VICTORY!" : "📉 DEFEAT")
                  .setColor(won ? 0x2ecc71 : 0xe74c3c)
                  .setDescription(
                    `### Winner: ${winner.emoji} ${winner.name}\n\n${generateTrack()}\n\n💰 **Result:** \`${won ? "+" : ""}${netChange.toLocaleString()}\` gold\n🏦 **Balance:** \`${finalUser.gold.toLocaleString()}\` gold`,
                  ),
              ],
            })
            .catch(() => null);
        }

        // Live Update
        await interaction
          .editReply({
            embeds: [
              new EmbedBuilder()
                .setTitle("🏇 RACE IN PROGRESS")
                .setColor(0x00aaff)
                .setDescription(
                  `👤 **Bettor:** <@${userId}>\n💰 **Bet:** \`${amount.toLocaleString()}\` on **${chosenHorse}**\n\n${generateTrack()}`,
                ),
            ],
          })
          .catch(() => {
            clearInterval(interval);
            clearTimeout(failSafe);
            activeRaces.delete(userId);
          });
      }, 2000);
    } catch (error) {
      console.error("Horse Race Error:", error);
      activeRaces.delete(userId);
      clearTimeout(failSafe);
    }
  },
};
