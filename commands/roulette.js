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
        .setPlaceholder("📍 Place your bet...")
        .addOptions([
          { label: "Red", value: "red", emoji: "🔴" },
          { label: "Black", value: "black", emoji: "⚫" },
          { label: "Even", value: "even", emoji: "🔢" },
          { label: "Odd", value: "odd", emoji: "🔢" },
          { label: "Green", value: "green", emoji: "🟢" },
        ]);

      const initialEmbed = new EmbedBuilder()
        .setTitle("🎰 ROULETTE TABLE")
        .setColor(0xffaa00)
        .setDescription(
          `👤 <@${userId}>\n💰 Bet: \`${amount.toLocaleString()}\` gold`,
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
              .setTitle("🎰 Spinning...")
              .setDescription(`Betting on **${space.toUpperCase()}**`),
          ],
          components: [],
        });

        setTimeout(async () => {
          try {
            // 🔥 Controlled win chance (38–44%)
            const WIN_CHANCE = 0.38 + Math.random() * 0.06;
            const isWin = Math.random() < WIN_CHANCE;

            const redNumbers = [
              1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
            ];

            const wheel = [
              "0",
              "00",
              ...Array.from({ length: 36 }, (_, i) => i + 1),
            ];

            let result;
            let resultColor;
            let multiplier = 0;
            let won = false;

            if (isWin) {
              won = true;

              if (space === "green") {
                multiplier = 18;
                result = Math.random() < 0.5 ? "0" : "00";
                resultColor = "green";
              } else {
                multiplier = 2;

                if (space === "red") {
                  result =
                    redNumbers[Math.floor(Math.random() * redNumbers.length)];
                  resultColor = "red";
                } else if (space === "black") {
                  const blacks = wheel.filter(
                    (n) => typeof n === "number" && !redNumbers.includes(n),
                  );
                  result = blacks[Math.floor(Math.random() * blacks.length)];
                  resultColor = "black";
                } else if (space === "even") {
                  const evens = wheel.filter(
                    (n) => typeof n === "number" && n % 2 === 0,
                  );
                  result = evens[Math.floor(Math.random() * evens.length)];
                  resultColor = redNumbers.includes(result) ? "red" : "black";
                } else if (space === "odd") {
                  const odds = wheel.filter(
                    (n) => typeof n === "number" && n % 2 !== 0,
                  );
                  result = odds[Math.floor(Math.random() * odds.length)];
                  resultColor = redNumbers.includes(result) ? "red" : "black";
                }
              }
            } else {
              // Force loss
              do {
                result = wheel[Math.floor(Math.random() * wheel.length)];
                const isGreen = result === "0" || result === "00";
                const isRed = !isGreen && redNumbers.includes(result);
                resultColor = isGreen ? "green" : isRed ? "red" : "black";

                won =
                  (space === resultColor && !isGreen) ||
                  (space === "green" && isGreen) ||
                  (space === "even" && !isGreen && result % 2 === 0) ||
                  (space === "odd" && !isGreen && result % 2 !== 0);
              } while (won);

              won = false;
              multiplier = 0;
            }

            const payout = won ? Math.floor(amount * multiplier) : 0;
            const netChange = won ? payout - amount : -amount;

            const updatedUser = await User.findOneAndUpdate(
              { userId },
              { $inc: { gold: payout } },
              { new: true },
            );

            const embed = new EmbedBuilder()
              .setTitle(won ? "✨ WINNER ✨" : "💀 HOUSE WINS")
              .setColor(won ? 0x2ecc71 : 0xe74c3c)
              .setDescription(
                `Ball: **${result} ${resultColor.toUpperCase()}**\n` +
                  `💰 Change: \`${netChange >= 0 ? "+" : ""}${netChange.toLocaleString()}\`\n` +
                  `🏦 Balance: \`${updatedUser.gold.toLocaleString()}\``,
              );

            const row = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId("rep")
                .setLabel("Bet Again")
                .setStyle(ButtonStyle.Success)
                .setDisabled(updatedUser.gold < amount),
              new ButtonBuilder()
                .setCustomId("quit")
                .setLabel("Quit")
                .setStyle(ButtonStyle.Secondary),
            );

            const msg = await interaction.editReply({
              embeds: [embed],
              components: [row],
            });

            const btnCollector = msg.createMessageComponentCollector({
              componentType: ComponentType.Button,
              time: 15000,
            });

            btnCollector.on("collect", async (btn) => {
              if (btn.user.id !== userId) return;

              if (btn.customId === "rep") {
                activeRoulette.delete(userId);
                clearTimeout(failSafe);
                await btn.deferUpdate();
                return module.exports.execute(btn, amount);
              }

              await btn.update({ components: [] });
            });

            await logToAudit(interaction.client, {
              userId,
              bet: amount,
              amount: netChange,
              oldBalance: userData.gold,
              newBalance: updatedUser.gold,
              reason: `Roulette (${space}) → ${result} ${resultColor}`,
            });
          } catch (err) {
            console.error(err);
            await User.updateOne({ userId }, { $inc: { gold: amount } });
          } finally {
            activeRoulette.delete(userId);
            clearTimeout(failSafe);
          }
        }, 2500);

        collector.stop();
      });

      collector.on("end", async (c, reason) => {
        if (reason === "time" && !settled) {
          activeRoulette.delete(userId);
          clearTimeout(failSafe);
          await User.updateOne({ userId }, { $inc: { gold: amount } });

          await interaction.editReply({
            content: "⏲️ Timed out. Refunded.",
            components: [],
          });
        }
      });
    } catch (err) {
      console.error(err);
      activeRoulette.delete(userId);
      if (failSafe) clearTimeout(failSafe);
    }
  },
};
