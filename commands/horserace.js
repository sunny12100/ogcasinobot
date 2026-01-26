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

    // 1. Check for active race
    if (activeRaces.has(userId)) {
      return interaction.reply({
        content:
          "❌ You already have a race in progress! If this is a bug, wait 30 seconds.",
        ephemeral: true,
      });
    }

    activeRaces.add(userId);

    // 2. Fail-safe: Auto-remove the lock after 60 seconds no matter what
    setTimeout(() => activeRaces.delete(userId), 60000);

    try {
      // 3. Atomic deduction
      const userData = await User.findOneAndUpdate(
        { userId, gold: { $gte: amount } },
        { $inc: { gold: -amount } },
        { new: true },
      );

      if (!userData) {
        activeRaces.delete(userId); // Release lock if they can't afford it
        return interaction.reply({
          content: "❌ Not enough gold!",
          ephemeral: true,
        });
      }

      const horses = [
        { name: "OG", emoji: "🔴", pos: 0 },
        { name: "CORGI", emoji: "🔵", pos: 0 },
        { name: "TITAN", emoji: "🟢", pos: 0 },
        { name: "IND", emoji: "🟡", pos: 0 },
      ];

      const finishLine = 15;
      let winner = null;

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
        // Move horses
        horses.forEach((h) => {
          if (Math.random() > 0.5) h.pos++;
        });

        const finishers = horses.filter((h) => h.pos >= finishLine - 1);

        if (finishers.length > 0) {
          clearInterval(interval);
          activeRaces.delete(userId); // CLEAR LOCK HERE

          winner = finishers[Math.floor(Math.random() * finishers.length)];
          const won = winner.name === chosenHorse;
          const winnings = amount * 2;

          let finalBalance = userData.gold;

          if (won) {
            const updatedUser = await User.findOneAndUpdate(
              { userId },
              { $inc: { gold: winnings } },
              { new: true },
            );
            finalBalance = updatedUser.gold;
          }

          await logToAudit(interaction.client, {
            userId,
            amount: won ? winnings - amount : -amount,
            reason: `Horse Race: ${chosenHorse} (Winner: ${winner.name})`,
          }).catch(() => null);

          return interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setTitle(won ? "🎉 VICTORY!" : "📉 DEFEAT")
                .setColor(won ? 0x2ecc71 : 0xe74c3c)
                .setDescription(
                  `### Winner: ${winner.emoji} ${winner.name}\n\n${generateTrack()}\n\n💰 **Result:** \`${won ? "+" : "-"}${won ? (winnings - amount).toLocaleString() : amount.toLocaleString()}\` gold\n🏦 **Balance:** \`${finalBalance.toLocaleString()}\` gold`,
                ),
            ],
          });
        }

        // Live Update
        await interaction
          .editReply({
            embeds: [
              new EmbedBuilder()
                .setTitle("🏇 RACE IN PROGRESS")
                .setColor(0x00aaff)
                .setDescription(
                  `👤 **Bettor:** <@${userId}>\n💰 **Bet:** \`${amount}\` on **${chosenHorse}**\n\n${generateTrack()}`,
                ),
            ],
          })
          .catch(() => {
            clearInterval(interval);
            activeRaces.delete(userId);
          });
      }, 1200);
    } catch (error) {
      console.error(error);
      activeRaces.delete(userId); // ENSURE LOCK IS CLEARED ON ERROR
    }
  },
};
