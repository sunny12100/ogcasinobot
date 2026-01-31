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

module.exports = {
  name: "highlow",
  async execute(interaction, repeatAmount = null) {
    const userId = interaction.user.id;
    const amount = repeatAmount ?? interaction.options.getInteger("amount");

    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply();
    }

    if (activeHighLow.has(userId)) {
      const lockMsg = "❌ You already have a game in progress!";
      return interaction.editReply({ content: lockMsg });
    }

    try {
      const userData = await User.findOne({ userId });
      if (!userData || userData.gold < amount) {
        const err = `❌ Not enough gold! Balance: \`${userData?.gold?.toLocaleString() || 0}\``;
        return interaction.editReply({ content: err });
      }

      const initialBalance = userData.gold;
      activeHighLow.add(userId);

      // 1. DEDUCT GOLD IMMEDIATELY (Hold the bet)
      await User.updateOne({ userId }, { $inc: { gold: -amount } });

      let gameStarted = false; // Flag to check if they clicked a button

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
        .setImage(
          "https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExYW5qb3o1ZW80N21kMXV0dmV4ZTg4eWU5M2FtY2M3NXN5NG9saGhndSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/2hjPmNNYtVGFy/giphy.gif",
        )
        .setDescription(
          `👤 **Player:** <@${userId}>\n💰 **Bet:** \`${amount.toLocaleString()}\` gold\n\nThe Dealer drew a: **[ ${dealerCard} ]**\nWill the next card be **Higher** or **Lower**?`,
        )
        .setFooter({ text: "Aces are the highest card!" });

      const response = await interaction.editReply({
        embeds: [initialEmbed],
        components: [row],
      });

      const collector = response.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 15000,
      });

      collector.on("collect", async (i) => {
        if (i.user.id !== userId)
          return i.reply({ content: "Not your game!", ephemeral: true });

        gameStarted = true; // Prevents the AFK refund from triggering
        const choice = i.customId;

        if (choice === "higher" || choice === "lower") {
          await i.update({
            embeds: [
              new EmbedBuilder()
                .setTitle("🃏 SHUFFLING...")
                .setColor(0xffaa00)
                .setImage(
                  "https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExcDJvZzRicXRqZnJiMjR0MXJ2ZGJhc2puN2JwbW43c21xaHg3NHJpNyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/bG5rDPx76wHMZtsXmr/giphy.gif",
                )
                .setDescription(`You bet **${choice.toUpperCase()}**!`),
            ],
            components: [],
          });

          setTimeout(async () => {
            activeHighLow.delete(userId);

            const isLucky = Math.random() < 0.45;
            let userIndex;

            if (isLucky) {
              userIndex =
                choice === "higher"
                  ? Math.floor(
                      Math.random() * (cards.length - 1 - dealerIndex),
                    ) +
                    (dealerIndex + 1)
                  : Math.floor(Math.random() * dealerIndex);
            } else {
              userIndex =
                choice === "higher"
                  ? Math.floor(Math.random() * (dealerIndex + 1))
                  : Math.floor(Math.random() * (cards.length - dealerIndex)) +
                    dealerIndex;
            }

            const userCard = cards[userIndex];
            const won =
              (choice === "higher" && userIndex > dealerIndex) ||
              (choice === "lower" && userIndex < dealerIndex);

            // 2. PAYOUT CALCULATION
            // If won, give back 2x (the original bet + the win). If lost, give 0.
            const payout = won ? amount * 2 : 0;
            const updatedUser = await User.findOneAndUpdate(
              { userId },
              { $inc: { gold: payout } },
              { new: true },
            );

            const resultEmbed = new EmbedBuilder()
              .setTitle(won ? "🎉 CORRECT!" : "💀 WRONG")
              .setColor(won ? 0x2ecc71 : 0xe74c3c)
              .setDescription(
                `### Dealer: **${dealerCard}** vs Your Card: **${userCard}**\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\nResult: You chose **${choice.toUpperCase()}** and were **${won ? "Right" : "Wrong"}**!\n\n💰 **Change:** \`${won ? "+" : "-"}${amount.toLocaleString()}\` gold\n🏦 **Balance:** \`${updatedUser.gold.toLocaleString()}\` gold`,
              );

            const repeatRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`hl_rep_${amount}`)
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

            await logToAudit(interaction.client, {
              userId: userId,
              bet: amount,
              amount: won ? amount : -amount,
              oldBalance: initialBalance,
              newBalance: updatedUser.gold,
              reason: `High-Low: ${choice.toUpperCase()} (Dealer: ${dealerCard} vs User: ${userCard})`,
            }).catch((err) => console.error("[AUDIT LOG ERROR]", err));

            const endCollector = finalMsg.createMessageComponentCollector({
              componentType: ComponentType.Button,
              time: 15000,
            });

            endCollector.on("collect", async (btnInt) => {
              if (btnInt.user.id !== userId)
                return btnInt.reply({ content: "Not yours!", ephemeral: true });
              endCollector.stop();
              activeHighLow.delete(userId);
              if (btnInt.customId.startsWith("hl_rep_"))
                return this.execute(btnInt, amount);
              if (btnInt.customId === "hl_quit")
                await btnInt.update({ components: [] });
            });
          }, 3000);
          collector.stop();
        }
      });

      collector.on("end", async (collected, reason) => {
        if (reason === "time") {
          activeHighLow.delete(userId);

          // 3. REFUND LOGIC
          if (!gameStarted) {
            await User.updateOne({ userId }, { $inc: { gold: amount } });
            interaction
              .editReply({
                content:
                  "⏲️ **Game Timed Out:** You didn't make a choice in time. Your bet has been refunded.",
                embeds: [],
                components: [],
              })
              .catch(() => null);
          } else {
            interaction.editReply({ components: [] }).catch(() => null);
          }
        }
      });
    } catch (err) {
      console.error(err);
      activeHighLow.delete(userId);
    }
  },
};
