const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const User = require("../models/User");
const { logToAudit } = require("../utils/logger");

const activeCoinflip = new Set();
const MAX_BET = 1000000;

module.exports = {
  name: "coinflip",
  async execute(interaction, repeatAmount = null) {
    const userId = interaction.user.id;
    const amount = repeatAmount ?? interaction.options?.getInteger?.("amount");

    // 1. VALIDATION (Before any Discord acknowledgement)
    if (!amount || amount <= 0 || amount > MAX_BET) {
      const err = "❌ Invalid bet amount (1 - 1,000,000 gold).";
      return interaction.replied || interaction.deferred
        ? interaction.editReply({ content: err })
        : interaction.reply({ content: err, ephemeral: true });
    }

    // LOCK CHECK (True Ephemeral)
    if (activeCoinflip.has(userId)) {
      const lockMsg = "❌ You already have a coin in the air!";
      return interaction.replied || interaction.deferred
        ? interaction.editReply({ content: lockMsg })
        : interaction.reply({ content: lockMsg, ephemeral: true });
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

      const initialBalance = userData.gold + amount;
      activeCoinflip.add(userId);
      failSafe = setTimeout(() => activeCoinflip.delete(userId), 35000);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("heads")
          .setLabel("Heads")
          .setStyle(ButtonStyle.Primary)
          .setEmoji("🪙"),
        new ButtonBuilder()
          .setCustomId("tails")
          .setLabel("Tails")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("🦅"),
      );

      const initialEmbed = new EmbedBuilder()
        .setTitle("🪙 COINFLIP: HEADS OR TAILS?")
        .setColor(0x5865f2)
        .setDescription(
          `👤 **Player:** <@${userId}>\n💰 **Bet:** \`${amount.toLocaleString()}\` gold\n\nPick a side! Win a **1.75x** payout.`,
        );

      const msg = await interaction.editReply({
        embeds: [initialEmbed],
        components: [row],
      });
      const collector = msg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 20000,
      });

      collector.on("collect", async (i) => {
        if (i.user.id !== userId)
          return i.reply({ content: "Not your game!", ephemeral: true });

        // Fix: Double-click race guard
        if (settled) return;
        settled = true;

        const choice = i.customId;

        // Visual Feedback
        await i.update({
          embeds: [
            new EmbedBuilder()
              .setTitle("🪙 FLIPPING...")
              .setColor(0xffaa00)
              .setImage(
                "https://media0.giphy.com/media/v1.Y2lkPTc5MGI3NjExY3NyOHdrYmsydDhoNXN2cGNxajl2cnVqNmN2enBscm1oZHJuZHg4eCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/6jqfXikz9yzhS/giphy.gif",
              ),
          ],
          components: [],
        });

        // 3. SECURE SETTLEMENT
        setTimeout(async () => {
          try {
            const resultSide = Math.random() < 0.5 ? "heads" : "tails";
            const won = resultSide === choice;

            const payout = won ? Math.floor(amount * 1.9) : 0;
            const netChange = won ? payout - amount : -amount;

            const updatedUser = await User.findOneAndUpdate(
              { userId },
              { $inc: { gold: payout } },
              { new: true },
            );

            if (!updatedUser)
              throw new Error("Database update failed during payout");

            const resultEmbed = new EmbedBuilder()
              .setTitle(won ? "🎉 WINNER!" : "💀 LOST")
              .setColor(won ? 0x2ecc71 : 0xe74c3c)
              .setDescription(
                `### The coin landed on: **${resultSide.toUpperCase()}**\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\nYou chose **${choice.toUpperCase()}** and **${won ? "Won" : "Lost"}**\n\n💰 **Change:** \`${netChange >= 0 ? "+" : ""}${netChange.toLocaleString()}\` gold\n🏦 **Balance:** \`${updatedUser.gold.toLocaleString()}\` gold`,
              );

            const repeatRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId("cf_rep")
                .setLabel("Flip Again")
                .setStyle(ButtonStyle.Success)
                .setDisabled(updatedUser.gold < amount),
              new ButtonBuilder()
                .setCustomId("cf_quit")
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

              if (btnInt.customId === "cf_rep") {
                // Fix: Clear locks before recursion
                activeCoinflip.delete(userId);
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
              reason: `Coinflip: ${choice.toUpperCase()} (${won ? "Won" : "Lost"})`,
            });
          } catch (settleErr) {
            console.error("[Coinflip Settlement Error]", settleErr);
            // Emergency Refund
            await User.updateOne({ userId }, { $inc: { gold: amount } }).catch(
              () => null,
            );
          } finally {
            activeCoinflip.delete(userId);
            clearTimeout(failSafe);
          }
        }, 2000);

        collector.stop();
      });

      collector.on("end", async (collected, reason) => {
        if (reason === "time" && !settled) {
          activeCoinflip.delete(userId);
          clearTimeout(failSafe);
          await User.updateOne({ userId }, { $inc: { gold: amount } }); // Refund
          await interaction
            .editReply({
              content: "⏲️ **Timed Out:** Refunded.",
              embeds: [],
              components: [],
            })
            .catch(() => null);
        }
      });
    } catch (err) {
      console.error("[Coinflip Fatal Error]", err);
      activeCoinflip.delete(userId);
      clearTimeout(failSafe);
    }
  },
};
