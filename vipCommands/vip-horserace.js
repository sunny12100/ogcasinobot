const { EmbedBuilder, SlashCommandBuilder } = require("discord.js");
const PassUser = require("../models/PassUser");

const activeVipRaces = new Set();

module.exports = {
  data: new SlashCommandBuilder()
    .setName("vip-horserace")
    .setDescription("💎 VIP LOUNGE: Elite Derby with 8x Super-Payouts")
    .addIntegerOption((opt) =>
      opt
        .setName("amount")
        .setDescription("Gold to bet (1-50,000)")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(50000),
    )
    .addStringOption((opt) =>
      opt
        .setName("horse")
        .setDescription("Pick your champion")
        .setRequired(true)
        .addChoices(
          { name: "OG (Red)", value: "OG" },
          { name: "SYNDICATE (Blue)", value: "SYNDICATE" },
          { name: "TITAN (Green)", value: "TITAN" },
          { name: "IND (Yellow)", value: "IND" },
        ),
    ),

  async execute(interaction) {
    const amount = interaction.options.getInteger("amount");
    const chosenHorse = interaction.options.getString("horse");
    const userId = interaction.user.id;
    const LOUNGE_ROLE = "1483219208962834473";

    if (!interaction.member.roles.cache.has(LOUNGE_ROLE)) {
      return interaction.reply({
        content: "🚫 Restricted to OG Pass holders!",
        ephemeral: true,
      });
    }

    if (activeVipRaces.has(userId)) {
      return interaction.reply({
        content: "❌ You already have a race running!",
        ephemeral: true,
      });
    }

    activeVipRaces.add(userId);
    const failSafe = setTimeout(() => activeVipRaces.delete(userId), 90000);

    try {
      // 1. Initial Deduction & VIP Auto-Reload
      let userData = await PassUser.findOneAndUpdate(
        { userId, passBalance: { $gte: amount } },
        { $inc: { passBalance: -amount, totalLost: amount, gamesPlayed: 1 } },
        { new: true },
      );

      if (!userData) {
        userData = await PassUser.findOneAndUpdate(
          { userId },
          { $set: { passBalance: 50000 }, $inc: { gamesPlayed: 1 } },
          { upsert: true, new: true },
        );
        userData = await PassUser.findOneAndUpdate(
          { userId },
          { $inc: { passBalance: -amount, totalLost: amount } },
          { new: true },
        );
      }

      const initialBalance = userData.passBalance + amount;

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
            .setTitle("💎 VIP ELITE DERBY")
            .setColor(0x00ffff)
            .setDescription(
              `💰 **Bet:** \`${amount.toLocaleString()}\` on **${chosenHorse}**\n🔥 **SUPER MULTIPLIER: 8.0x**\n\n${generateTrack()}`,
            ),
        ],
      });

      const interval = setInterval(async () => {
        horses.forEach((h) => {
          const boost = Math.random();
          if (boost > 0.6)
            h.pos += 2; // VIP horses are high-performance
          else if (boost > 0.3) h.pos += 1;
        });

        const finishers = horses.filter((h) => h.pos >= finishLine - 1);

        if (finishers.length > 0) {
          clearInterval(interval);
          clearTimeout(failSafe);
          activeVipRaces.delete(userId);

          const winner =
            finishers[Math.floor(Math.random() * finishers.length)];
          const won = winner.name === chosenHorse;
          const winnings = amount * 8; // UPDATED PAYOUT

          let finalUser;
          if (won) {
            finalUser = await PassUser.findOneAndUpdate(
              { userId },
              { $inc: { passBalance: winnings, totalWon: winnings } },
              { new: true },
            );
          } else {
            finalUser = await PassUser.findOne({ userId });
          }

          const netChange = finalUser.passBalance - initialBalance;

          return interaction
            .editReply({
              embeds: [
                new EmbedBuilder()
                  .setTitle(won ? "🌟 MASSIVE VIP WIN!" : "📉 DERBY DEFEAT")
                  .setColor(won ? 0xf1c40f : 0xe74c3c)
                  .setDescription(
                    `### Winner: ${winner.emoji} ${winner.name}\n\n${generateTrack()}\n\n💰 **Result:** \`${won ? "+" : ""}${netChange.toLocaleString()}\` gold\n🏦 **VIP Balance:** \`${finalUser.passBalance.toLocaleString()}\` gold`,
                  ),
              ],
            })
            .catch(() => null);
        }

        await interaction
          .editReply({
            embeds: [
              new EmbedBuilder()
                .setTitle("🏇 VIP RACE IN PROGRESS")
                .setColor(0x00ffff)
                .setDescription(
                  `💰 **Betting:** \`${amount.toLocaleString()}\` on **${chosenHorse}**\n🏆 **Multiplier:** \`8x\`\n\n${generateTrack()}`,
                ),
            ],
          })
          .catch(() => {
            clearInterval(interval);
            clearTimeout(failSafe);
            activeVipRaces.delete(userId);
          });
      }, 2000);
    } catch (error) {
      console.error("VIP Horse Race Error:", error);
      activeVipRaces.delete(userId);
      clearTimeout(failSafe);
    }
  },
};
