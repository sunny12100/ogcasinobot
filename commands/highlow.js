const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const User = require("../models/User");
const { logToAudit } = require("../utils/logger");

const activeHighLow = new Set();
const MAX_BET = 500;

module.exports = {
  name: "highlow",
  async execute(interaction, repeatAmount = null) {
    const userId = interaction.user.id;
    const amount = repeatAmount ?? interaction.options?.getInteger?.("amount");

    // Validation
    if (!amount || amount <= 0 || amount > MAX_BET) {
      return interaction
        .reply({
          content: "❌ Invalid bet amount (1 - 1M gold).",
          ephemeral: true,
        })
        .catch(() => null);
    }

    // Lock Check
    if (activeHighLow.has(userId)) {
      return interaction
        .reply({
          content: "❌ You already have a game in progress!",
          ephemeral: true,
        })
        .catch(() => null);
    }

    if (!interaction.deferred && !interaction.replied)
      await interaction.deferReply();

    let settled = false;
    let failSafe;

    try {
      // Atomic bet deduction
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

      const initialBalance = userData.gold + amount;

      activeHighLow.add(userId);
      failSafe = setTimeout(() => activeHighLow.delete(userId), 35000);

      const cards = [
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
        "10",
        "J",
        "Q",
        "K",
        "A",
      ];

      const dealerIndex = Math.floor(Math.random() * (cards.length - 2)) + 1;
      const dealerCard = cards[dealerIndex];

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("higher")
          .setLabel("Higher")
          .setStyle(ButtonStyle.Success)
          .setEmoji("⬆️"),
        new ButtonBuilder()
          .setCustomId("lower")
          .setLabel("Lower")
          .setStyle(ButtonStyle.Danger)
          .setEmoji("⬇️"),
      );

      const initialEmbed = new EmbedBuilder()
        .setTitle("🃏 HIGH-LOW CARDS")
        .setColor(0x5865f2)
        .setDescription(
          `💰 **Bet:** \`${amount.toLocaleString()}\` gold\n\nDealer's Card: **[ ${dealerCard} ]**\nWill the next card be **Higher** or **Lower**?`,
        )
        .setFooter({ text: "Ties go to the House! Aces are High." });

      const msg = await interaction.editReply({
        embeds: [initialEmbed],
        components: [row],
      });

      const collector = msg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 15000,
      });

      collector.on("collect", async (i) => {
        if (i.user.id !== userId)
          return i.reply({ content: "Not your game!", ephemeral: true });

        if (settled) return;
        settled = true;

        const choice = i.customId;
        const userIndex = Math.floor(Math.random() * cards.length);
        const userCard = cards[userIndex];

        const won =
          (choice === "higher" && userIndex > dealerIndex) ||
          (choice === "lower" && userIndex < dealerIndex);

        const payout = won ? Math.floor(amount * 1.75) : 0;
        const netChange = won ? payout - amount : -amount;

        await i.update({
          embeds: [
            new EmbedBuilder()
              .setTitle("🃏 SHUFFLING...")
              .setColor(0xffaa00)
              .setImage(
                "https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExcDJvZzRicXRqZnJiMjR0MXJ2ZGJhc2puN2JwbW43c21xaHg3NHJpNyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/bG5rDPx76wHMZtsXmr/giphy.gif",
              ),
          ],
          components: [],
        });

        setTimeout(async () => {
          try {
            const updatedUser = await User.findOneAndUpdate(
              { userId },
              { $inc: { gold: payout } },
              { new: true },
            );

            if (!updatedUser)
              throw new Error("Database update failed during payout");

            const resultEmbed = new EmbedBuilder()
              .setTitle(won ? "🎉 CORRECT!" : "💀 WRONG")
              .setColor(won ? 0x2ecc71 : 0xe74c3c)
              .setDescription(
                `### Dealer: **${dealerCard}** vs You: **${userCard}**
Result: You were **${won ? "Right" : "Wrong"}**!

💰 **Payout:** \`${won ? payout.toLocaleString() : "0"}\` gold
📈 **Net Change:** \`${netChange >= 0 ? "+" : ""}${netChange.toLocaleString()}\` gold
🏦 **Balance:** \`${updatedUser.gold.toLocaleString()}\` gold`,
              );

            const repeatRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId("hl_rep")
                .setLabel("Play Again")
                .setStyle(ButtonStyle.Success)
                .setDisabled(updatedUser.gold < amount),
              new ButtonBuilder()
                .setCustomId("hl_quit")
                .setLabel("Quit")
                .setStyle(ButtonStyle.Secondary),
            );

            const finalMsg = await interaction.editReply({
              embeds: [resultEmbed],
              components: [repeatRow],
            });

            const endCollector = finalMsg.createMessageComponentCollector({
              componentType: ComponentType.Button,
              time: 10000,
            });

            endCollector.on("collect", async (btnInt) => {
              if (btnInt.user.id !== userId)
                return btnInt.reply({ content: "Not yours!", ephemeral: true });

              endCollector.stop("replay");

              if (btnInt.customId === "hl_rep") {
                activeHighLow.delete(userId);
                clearTimeout(failSafe);
                await btnInt.deferUpdate();
                return module.exports.execute(btnInt, Number(amount));
              }

              await btnInt.update({ components: [] });
            });

            await logToAudit(interaction.client, {
              userId,
              bet: amount,
              amount: netChange,
              oldBalance: initialBalance,
              newBalance: updatedUser.gold,
              reason: `High-Low: ${choice.toUpperCase()} (D: ${dealerCard} vs U: ${userCard})`,
            });
          } catch (settleErr) {
            console.error("[HighLow Settlement Error]", settleErr);

            // Emergency refund (loss-safe bias)
            await User.updateOne({ userId }, { $inc: { gold: amount } }).catch(
              () => null,
            );
          } finally {
            activeHighLow.delete(userId);
            clearTimeout(failSafe);
          }
        }, 2000);

        collector.stop();
      });

      collector.on("end", async (collected, reason) => {
        if (reason === "time" && !settled) {
          activeHighLow.delete(userId);
          clearTimeout(failSafe);

          await User.updateOne({ userId }, { $inc: { gold: amount } });

          await interaction
            .editReply({
              content: "⏲️ **Timed Out:** Bet refunded.",
              embeds: [],
              components: [],
            })
            .catch(() => null);
        }
      });
    } catch (err) {
      console.error("[HighLow Fatal Error]", err);
      activeHighLow.delete(userId);
      clearTimeout(failSafe);
    }
  },
};
