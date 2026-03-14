const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const User = require("../models/User");
const { logToAudit } = require("../utils/logger");
const crypto = require("crypto");

const activeDice = new Set();
const MAX_BET = 1000000;

function randomFloat() {
  return crypto.randomBytes(4).readUInt32BE() / 2 ** 32;
}

function rollDie() {
  return crypto.randomInt(1, 7);
}

function rollDice() {
  return rollDie() + rollDie();
}

module.exports = {
  name: "dice",
  async execute(interaction, repeatAmount = null) {
    const userId = interaction.user.id;
    const amount = repeatAmount ?? interaction.options?.getInteger?.("amount");

    if (!amount || amount <= 0 || amount > MAX_BET) {
      return interaction
        .reply({ content: "❌ Invalid bet (1 - 1M gold).", ephemeral: true })
        .catch(() => null);
    }

    if (activeDice.has(userId)) {
      return interaction
        .reply({ content: "❌ You are already rolling!", ephemeral: true })
        .catch(() => null);
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
          content: `❌ Not enough gold! Balance: \`${(
            existing?.gold ?? 0
          ).toLocaleString()}\``,
        });
      }

      const initialBalance = userData.gold + amount;

      activeDice.add(userId);
      failSafe = setTimeout(() => activeDice.delete(userId), 35000);

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
        .setTitle("🎲 DOUBLE DICE")
        .setColor(0x5865f2)
        .setDescription(
          `💰 **Bet:** \`${amount.toLocaleString()}\` gold\n\nChoose **Higher** or **Lower**.\nWin pays **2×**`,
        )
        .setFooter({ text: "House Edge: 5%" });

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

        if (settled) return;
        settled = true;

        const choice = i.customId;

        await i.update({
          embeds: [
            new EmbedBuilder()
              .setTitle("🎲 ROLLING...")
              .setColor(0xffaa00)
              .setImage(
                "https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExbDg5MGR2czlqYzc5ZWljdXNtYTUxN295ZXBlcWdvbDF3aTB3aGF3ZiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/0mkK0hzJmL69KInkIZ/giphy.gif",
              ),
          ],
          components: [],
        });

        setTimeout(async () => {
          try {
            const winChance = 0.475;
            const won = randomFloat() < winChance;

            let dealerRoll, userRoll;

            do {
              dealerRoll = rollDice();
              userRoll = rollDice();
            } while (
              (won && userRoll <= dealerRoll) ||
              (!won && userRoll > dealerRoll)
            );

            const correct =
              (choice === "higher" && userRoll > dealerRoll) ||
              (choice === "lower" && userRoll < dealerRoll);

            const finalWin = won && correct;

            const payout = finalWin ? amount * 2 : 0;
            const netChange = finalWin ? amount : -amount;

            const updatedUser = await User.findOneAndUpdate(
              { userId },
              { $inc: { gold: payout } },
              { new: true },
            );

            const resultEmbed = new EmbedBuilder()
              .setTitle(finalWin ? "🎉 YOU WON!" : "💀 HOUSE WINS")
              .setColor(finalWin ? 0x2ecc71 : 0xe74c3c)
              .setDescription(
                `### Dealer: **${dealerRoll}** vs You: **${userRoll}**
Result: You were **${finalWin ? "Correct" : "Incorrect"}**

💰 **Change:** \`${netChange >= 0 ? "+" : ""}${netChange.toLocaleString()}\` gold
🏦 **Balance:** \`${updatedUser.gold.toLocaleString()}\` gold`,
              );

            const repeatRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId("dice_rep")
                .setLabel("Roll Again")
                .setStyle(ButtonStyle.Success)
                .setDisabled(updatedUser.gold < amount),
              new ButtonBuilder()
                .setCustomId("dice_quit")
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

              endCollector.stop();

              if (btnInt.customId === "dice_rep") {
                activeDice.delete(userId);
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
              reason: `Dice: ${choice.toUpperCase()} (${dealerRoll} vs ${userRoll})`,
            });
          } catch (err) {
            console.error("Dice Settle Error:", err);
            await User.updateOne({ userId }, { $inc: { gold: amount } }).catch(
              () => null,
            );
          } finally {
            activeDice.delete(userId);
            clearTimeout(failSafe);
          }
        }, 2000);

        collector.stop();
      });

      collector.on("end", async (collected, reason) => {
        if (reason === "time" && !settled) {
          activeDice.delete(userId);
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
      console.error("Dice Fatal Error:", err);
      activeDice.delete(userId);
      clearTimeout(failSafe);
    }
  },
};
