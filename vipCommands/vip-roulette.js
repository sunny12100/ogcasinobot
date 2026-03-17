const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  SlashCommandBuilder,
} = require("discord.js");
const PassUser = require("../models/PassUser");

const activeVipRoulette = new Set();
const MAX_BET = 10000; // Updated Max Bet

module.exports = {
  data: new SlashCommandBuilder()
    .setName("vip-roulette")
    .setDescription("💎 VIP LOUNGE: Roulette")
    .addIntegerOption((opt) =>
      opt
        .setName("amount")
        .setDescription("Gold to bet (1-10,000)")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(10000),
    ),

  async execute(interaction, repeatAmount = null) {
    const userId = interaction.user.id;
    const amount = repeatAmount ?? interaction.options.getInteger("amount");
    const LOUNGE_ROLE = "1483219208962834473";

    if (!interaction.member.roles.cache.has(LOUNGE_ROLE)) {
      return interaction.reply({
        content: "🚫 Restricted to OG Pass holders!",
        ephemeral: true,
      });
    }

    if (activeVipRoulette.has(userId)) {
      return interaction.reply({
        content: "❌ You already have a bet on the table!",
        ephemeral: true,
      });
    }

    if (!interaction.deferred && !interaction.replied)
      await interaction.deferReply();

    let settled = false;
    let failSafe;

    try {
      // 1. Atomic Deduction & VIP Reload (Bust Protection)
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

      activeVipRoulette.add(userId);
      failSafe = setTimeout(() => activeVipRoulette.delete(userId), 45000);

      const menu = new StringSelectMenuBuilder()
        .setCustomId("vip_roulette_bet")
        .setPlaceholder("📍 Place your VIP bet...")
        .addOptions([
          {
            label: "Red",
            value: "red",
            description: "VIP Payout: 3x",
            emoji: "🔴",
          },
          {
            label: "Black",
            value: "black",
            description: "VIP Payout: 3x",
            emoji: "⚫",
          },
          {
            label: "Even",
            value: "even",
            description: "VIP Payout: 3x",
            emoji: "🔢",
          },
          {
            label: "Odd",
            value: "odd",
            description: "VIP Payout: 3x",
            emoji: "🔢",
          },
          {
            label: "Green (0/00)",
            value: "green",
            description: "VIP Payout: 55x",
            emoji: "🟢",
          },
        ]);

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("💎 VIP ROULETTE TABLE")
            .setColor(0x00ffff)
            .setImage(
              "https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExcTRzYnljc3ozbzk5cG9xb2ozNDNrczR5bDJ1OXdkOXR2OXd5aDlvdSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/26uflBhaGt5lQsaCA/giphy.gif",
            )
            .setDescription(
              `💰 **VIP Stake:** \`${amount.toLocaleString()}\` gold\n\n*Select a space. RTP is boosted to 150%!*`,
            ),
        ],
        components: [new ActionRowBuilder().addComponents(menu)],
      });

      const response = await interaction.fetchReply();
      const collector = response.createMessageComponentCollector({
        filter: (i) => i.user.id === userId,
        componentType: ComponentType.StringSelect,
        time: 30000,
      });

      collector.on("collect", async (i) => {
        if (settled) return;
        settled = true;
        const space = i.values[0];

        await i.update({
          embeds: [
            new EmbedBuilder()
              .setTitle("💎 SPINNING...")
              .setColor(0x00ffff)
              .setDescription(
                `🎲 VIP Bet: \`${amount.toLocaleString()}\` on **${space.toUpperCase()}**`,
              ),
          ],
          components: [],
        });

        setTimeout(async () => {
          try {
            const redNumbers = [
              1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
            ];
            const wheel = [
              "0",
              "00",
              1,
              2,
              3,
              4,
              5,
              6,
              7,
              8,
              9,
              10,
              11,
              12,
              13,
              14,
              15,
              16,
              17,
              18,
              19,
              20,
              21,
              22,
              23,
              24,
              25,
              26,
              27,
              28,
              29,
              30,
              31,
              32,
              33,
              34,
              35,
              36,
            ];

            const result = wheel[Math.floor(Math.random() * wheel.length)];
            const isGreen = result === "0" || result === "00";
            const isRed = !isGreen && redNumbers.includes(result);
            const resultColor = isGreen ? "green" : isRed ? "red" : "black";

            let won = false;
            let multiplier = 0;

            // 150% RTP LOGIC
            if (space === resultColor && !isGreen) {
              won = true;
              multiplier = 3;
            } else if (space === "green" && isGreen) {
              won = true;
              multiplier = 55;
            } else if (space === "even" && !isGreen && result % 2 === 0) {
              won = true;
              multiplier = 3;
            } else if (space === "odd" && !isGreen && result % 2 !== 0) {
              won = true;
              multiplier = 3;
            }

            const payout = won ? Math.floor(amount * multiplier) : 0;
            const updatedUser = await PassUser.findOneAndUpdate(
              { userId },
              { $inc: { passBalance: payout, totalWon: payout } },
              { new: true },
            );

            const resultEmbed = new EmbedBuilder()
              .setTitle(won ? "🌟 VIP WINNER 🌟" : "💀 HOUSE WINS")
              .setColor(won ? 0x2ecc71 : 0xe74c3c)
              .setDescription(
                `### Ball landed on: **${result} ${resultColor.toUpperCase()}**\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n💰 **Payout:** \`${payout.toLocaleString()}\` gold\n🏦 **VIP Balance:** \`${updatedUser.passBalance.toLocaleString()}\` gold`,
              );

            const repeatRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId("vip_roulette_rep")
                .setLabel("Bet Again")
                .setStyle(ButtonStyle.Success)
                .setDisabled(updatedUser.passBalance < amount),
              new ButtonBuilder()
                .setCustomId("vip_roulette_quit")
                .setLabel("Quit")
                .setStyle(ButtonStyle.Secondary),
            );

            const finalMsg = await interaction.editReply({
              embeds: [resultEmbed],
              components: [repeatRow],
            });
            const btnCollector = finalMsg.createMessageComponentCollector({
              componentType: ComponentType.Button,
              time: 15000,
            });

            btnCollector.on("collect", async (btn) => {
              if (btn.user.id !== userId) return;
              btnCollector.stop();
              if (btn.customId === "vip_roulette_rep") {
                activeVipRoulette.delete(userId);
                clearTimeout(failSafe);
                await btn.deferUpdate();
                return module.exports.execute(btn, Number(amount));
              }
              await btn.update({ components: [] });
            });
          } catch (err) {
            console.error(err);
            await PassUser.updateOne(
              { userId },
              { $inc: { passBalance: amount } },
            );
          } finally {
            activeVipRoulette.delete(userId);
            clearTimeout(failSafe);
          }
        }, 3000);
        collector.stop();
      });

      collector.on("end", async (_, reason) => {
        if (reason === "time" && !settled) {
          activeVipRoulette.delete(userId);
          clearTimeout(failSafe);
          await PassUser.updateOne(
            { userId },
            { $inc: { passBalance: amount, totalLost: -amount } },
          );
          await interaction
            .editReply({
              content: "⏲️ **Timed Out:** Refunded.",
              components: [],
            })
            .catch(() => null);
        }
      });
    } catch (err) {
      activeVipRoulette.delete(userId);
      if (failSafe) clearTimeout(failSafe);
    }
  },
};
