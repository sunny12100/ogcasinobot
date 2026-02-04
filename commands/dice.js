const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const User = require("../models/User");
const { logToAudit } = require("../utils/logger");

const activeDice = new Set();

module.exports = {
  name: "dice",
  async execute(interaction, repeatAmount = null) {
    const userId = interaction.user.id;
    const amount = repeatAmount ?? interaction.options.getInteger("amount");

    // 1. DEFER & LOCK
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply();
    }

    if (activeDice.has(userId)) {
      const lockMsg = "❌ You are already rolling the dice!";
      return interaction.editReply({ content: lockMsg });
    }

    try {
      // 2. DATA VALIDATION
      const userData = await User.findOne({ userId });
      if (!userData || userData.gold < amount) {
        const err = `❌ Not enough gold! Balance: \`${userData?.gold?.toLocaleString() || 0}\``;
        return interaction.editReply({ content: err });
      }

      const initialBalance = userData.gold; // 💾 SNAPSHOT
      activeDice.add(userId);
      const failSafe = setTimeout(() => activeDice.delete(userId), 30000);

      const dealerRoll =
        Math.floor(Math.random() * 6) + 1 + (Math.floor(Math.random() * 6) + 1);
      const diceEmojis = {
        2: "⚀⚀",
        3: "⚀⚁",
        4: "⚁⚁",
        5: "⚁⚂",
        6: "⚂⚂",
        7: "⚅⚀",
        8: "⚃⚃",
        9: "⚃⚄",
        10: "⚅⚃",
        11: "⚅⚄",
        12: "⚅⚅",
      };

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
        .setTitle("🎲 DOUBLE DICE: HIGHER OR LOWER")
        .setColor(0x5865f2)
        .setImage(
          "https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExYXJzd2lyM2g1Y3h5bGNlOHNrMGNzOXg1NnptOXd4NTVrbDFsdWhtbyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/W6bZ7NNFlS8PGx2fPo/giphy.gif",
        )
        .setDescription(
          `👤 **Player:** <@${userId}>\n💰 **Bet:** \`${amount.toLocaleString()}\` gold\n\nDealer rolled: **${diceEmojis[dealerRoll] || "🎲🎲"} (${dealerRoll})**\nWill the next roll be **Higher** or **Lower**?`,
        );

      const response = await interaction.editReply({
        embeds: [initialEmbed],
        components: [row],
      });

      const collector = response.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 20000,
      });

      collector.on("collect", async (i) => {
        if (i.user.id !== userId)
          return i.reply({ content: "Not your game!", ephemeral: true });

        const choice = i.customId;

        // --- GAME LOGIC ---
        if (choice === "higher" || choice === "lower") {
          await i.update({
            embeds: [
              new EmbedBuilder()
                .setTitle("🎲 ROLLING...")
                .setColor(0xffaa00)
                .setImage(
                  "https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExbDg5MGR2czlqYzc5ZWljdXNtYTUxN295ZXBlcWdvbDF3aTB3aGF3ZiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/0mkK0hzJmL69KInkIZ/giphy.gif",
                )
                .setDescription(`You bet **${choice.toUpperCase()}**!`),
            ],
            components: [],
          });

          setTimeout(async () => {
            clearTimeout(failSafe);
            activeDice.delete(userId);

            const isLucky = Math.random() < 0.45;
            let userRoll;

            if (isLucky) {
              if (choice === "higher" && dealerRoll < 12)
                userRoll =
                  Math.floor(Math.random() * (12 - dealerRoll)) +
                  (dealerRoll + 1);
              else if (choice === "lower" && dealerRoll > 2)
                userRoll = Math.floor(Math.random() * (dealerRoll - 2)) + 2;
              else userRoll = dealerRoll;
            } else {
              if (choice === "higher")
                userRoll = Math.floor(Math.random() * (dealerRoll - 1)) + 2;
              else
                userRoll =
                  Math.floor(Math.random() * (13 - dealerRoll)) + dealerRoll;
            }

            const actuallyWon =
              (choice === "higher" && userRoll > dealerRoll) ||
              (choice === "lower" && userRoll < dealerRoll);
            const netChange = actuallyWon ? amount : -amount;

            const updatedUser = await User.findOneAndUpdate(
              { userId },
              { $inc: { gold: netChange } },
              { new: true },
            );

            const resultEmbed = new EmbedBuilder()
              .setTitle(actuallyWon ? "🎉 YOU WON!" : "💀 HOUSE WINS")
              .setColor(actuallyWon ? 0x2ecc71 : 0xe74c3c)
              .setDescription(
                `### Dealer: **${dealerRoll}** vs You: **${userRoll}**\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\nThe dice show: **${diceEmojis[userRoll] || "🎲🎲"}**\nResult: You chose **${choice.toUpperCase()}** and **${actuallyWon ? "Won" : "Lost"}**\n\n💰 **Change:** \`${netChange >= 0 ? "+" : ""}${netChange.toLocaleString()}\` gold\n🏦 **Balance:** \`${updatedUser.gold.toLocaleString()}\` gold`,
              );

            const repeatRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`dice_rep_${amount}`)
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

            // 5. AUDIT LOG
            await logToAudit(interaction.client, {
              userId: userId,
              bet: amount,
              amount: netChange,
              oldBalance: initialBalance,
              newBalance: updatedUser.gold,
              reason: `Dice: ${choice.toUpperCase()} (Dealer ${dealerRoll} vs User ${userRoll})`,
            }).catch(() => null);

            // --- REPEAT COLLECTOR ---
            const endCollector = finalMsg.createMessageComponentCollector({
              componentType: ComponentType.Button,
              time: 15000,
            });

            endCollector.on("collect", async (btnInt) => {
              if (btnInt.user.id !== userId)
                return btnInt.reply({ content: "Not yours!", ephemeral: true });

              endCollector.stop();
              activeDice.delete(userId); // Ensure lock is gone before re-running

              if (btnInt.customId.startsWith("dice_rep_")) {
                return this.execute(btnInt, amount);
              }
              if (btnInt.customId === "dice_quit") {
                await btnInt.update({ components: [] });
              }
            });
          }, 2000);
          collector.stop();
        }
      });

      collector.on("end", (collected, reason) => {
        if (reason === "time") {
          activeDice.delete(userId);
          interaction.editReply({ components: [] }).catch(() => null);
        }
      });
    } catch (err) {
      console.error(err);
      activeDice.delete(userId);
    }
  },
};
