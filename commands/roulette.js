const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const User = require("../models/User");
const { logToAudit } = require("../utils/logger");

const activeRoulette = new Set();
const MAX_BET = 1000000;

module.exports = {
  name: "roulette",
  async execute(interaction, repeatAmount = null) {
    const userId = interaction.user.id;
    const amount = repeatAmount ?? interaction.options?.getInteger?.("amount");

    // 1. CONSISTENT INTERACTION HANDLING
    const sendError = async (content) => {
      const payload = { content, ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        return interaction.editReply(payload).catch(() => null);
      }
      return interaction.reply(payload).catch(() => null);
    };

    if (!amount || amount <= 0 || amount > MAX_BET) {
      return sendError("❌ Invalid bet (1 - 1M gold).");
    }

    if (activeRoulette.has(userId)) {
      return sendError("❌ You already have a bet on the table!");
    }

    if (!interaction.deferred && !interaction.replied)
      await interaction.deferReply();

    let settled = false;
    let failSafe;

    try {
      // 2. ATOMIC DEDUCTION
      const userData = await User.findOneAndUpdate(
        { userId, gold: { $gte: amount } },
        { $inc: { gold: -amount } },
        { new: true },
      );

      if (!userData) {
        const existing = await User.findOne({ userId });
        return interaction.editReply({
          content: `❌ Not enough gold! Balance: \`${(existing?.gold ?? 0).toLocaleString()}\``,
        });
      }

      activeRoulette.add(userId);
      failSafe = setTimeout(() => activeRoulette.delete(userId), 45000);

      const menu = new StringSelectMenuBuilder()
        .setCustomId("roulette_bet")
        .setPlaceholder("📍 Place your bet on the table...")
        .addOptions([
          {
            label: "Red",
            value: "red",
            description: "Payout: 2x",
            emoji: "🔴",
          },
          {
            label: "Black",
            value: "black",
            description: "Payout: 2x",
            emoji: "⚫",
          },
          {
            label: "Even",
            value: "even",
            description: "Payout: 2x",
            emoji: "🔢",
          },
          {
            label: "Odd",
            value: "odd",
            description: "Payout: 2x",
            emoji: "🔢",
          },
          {
            label: "Green (0/00)",
            value: "green",
            description: "Payout: 18x (17:1)",
            emoji: "🟢",
          },
        ]);

      const initialEmbed = new EmbedBuilder()
        .setTitle("🎰 ROULETTE TABLE")
        .setColor(0xffaa00)
        .setImage(
          "https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExcTRzYnljc3ozbzk5cG9xb2ozNDNrczR5bDJ1OXdkOXR2OXd5aDlvdSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/26uflBhaGt5lQsaCA/giphy.gif",
        )
        .setDescription(
          `👤 **Player:** <@${userId}>\n💰 **Bet:** \`${amount.toLocaleString()}\` gold\n\n*Select a space to spin!*`,
        );

      const response = await interaction.editReply({
        embeds: [initialEmbed],
        components: [new ActionRowBuilder().addComponents(menu)],
      });

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
              .setTitle("🎰 WHEEL IS SPINNING...")
              .setColor(0xffaa00)
              .setDescription(
                `🎲 You bet \`${amount.toLocaleString()}\` on **${space.toUpperCase()}**`,
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

            if (space === resultColor && !isGreen) {
              won = true;
              multiplier = 2;
            } else if (space === "green" && isGreen) {
              won = true;
              multiplier = 18; // 17:1 + original bet
            } else if (space === "even" && !isGreen && result % 2 === 0) {
              won = true;
              multiplier = 2;
            } else if (space === "odd" && !isGreen && result % 2 !== 0) {
              won = true;
              multiplier = 2;
            }

            const payout = won ? Math.floor(amount * multiplier) : 0;
            const netChange = won ? payout - amount : -amount;

            const updatedUser = await User.findOneAndUpdate(
              { userId },
              { $inc: { gold: payout } },
              { new: true },
            );
            if (!updatedUser) throw new Error("Payout Failed");

            const resultEmbed = new EmbedBuilder()
              .setTitle(won ? "✨ WINNER ✨" : "💀 HOUSE WINS")
              .setColor(won ? 0x2ecc71 : 0xe74c3c)
              .setDescription(
                `### Ball landed on: **${result} ${resultColor.toUpperCase()}**\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n💰 **Change:** \`${netChange >= 0 ? "+" : ""}${netChange.toLocaleString()}\` gold\n🏦 **Balance:** \`${updatedUser.gold.toLocaleString()}\` gold`,
              );

            const repeatRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId("roulette_rep")
                .setLabel(`Bet Again`)
                .setStyle(ButtonStyle.Success)
                .setDisabled(updatedUser.gold < amount),
              new ButtonBuilder()
                .setCustomId("roulette_quit")
                .setLabel("Quit")
                .setStyle(ButtonStyle.Secondary),
            );

            const finalMsg = await interaction.editReply({
              embeds: [resultEmbed],
              components: [repeatRow],
            });
            const repeatCollector = finalMsg.createMessageComponentCollector({
              componentType: ComponentType.Button,
              time: 15000,
            });

            repeatCollector.on("collect", async (btn) => {
              if (btn.user.id !== userId) return;
              repeatCollector.stop();

              if (btn.customId === "roulette_rep") {
                activeRoulette.delete(userId);
                clearTimeout(failSafe);
                await btn.deferUpdate();
                return module.exports.execute(btn, Number(amount));
              }
              await btn.update({ components: [] });
            });

            await logToAudit(interaction.client, {
              userId,
              bet: amount,
              amount: netChange,
              oldBalance: userData.gold,
              newBalance: updatedUser.gold,
              reason: `Roulette: ${space.toUpperCase()} (Ball: ${result} ${resultColor.toUpperCase()})`,
            });
          } catch (err) {
            console.error("Roulette Settlement Error:", err);
            await User.updateOne({ userId }, { $inc: { gold: amount } }).catch(
              () => null,
            );
          } finally {
            activeRoulette.delete(userId);
            clearTimeout(failSafe);
          }
        }, 3000);
        collector.stop();
      });

      collector.on("end", async (collected, reason) => {
        if (reason === "time" && !settled) {
          activeRoulette.delete(userId);
          clearTimeout(failSafe);
          await User.updateOne({ userId }, { $inc: { gold: amount } });
          await interaction
            .editReply({
              content: "⏲️ **Timed Out:** Refunded.",
              components: [],
            })
            .catch(() => null);
        }
      });
    } catch (err) {
      console.error("Roulette Fatal Error:", err);
      // BUG FIX: Correct lock cleanup
      activeRoulette.delete(userId);
      if (failSafe) clearTimeout(failSafe);
    }
  },
};
