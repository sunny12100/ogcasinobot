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

    // 1. DEFER & LOCK CHECK
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply();
    }

    if (activeHighLow.has(userId)) {
      const lockMsg = "❌ You already have a game in progress!";
      return interaction.editReply({ content: lockMsg });
    }

    try {
      // 2. FETCH USER & SNAPSHOT
      const userData = await User.findOne({ userId });
      if (!userData || userData.gold < amount) {
        const err = `❌ Not enough gold! Balance: \`${userData?.gold?.toLocaleString() || 0}\``;
        return interaction.editReply({ content: err });
      }

      const initialBalance = userData.gold;
      activeHighLow.add(userId);
      const failSafe = setTimeout(() => activeHighLow.delete(userId), 30000);

      // --- GAME CONFIG ---
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

        const choice = i.customId;

        // --- GAME STEP ---
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
            clearTimeout(failSafe);
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
            const netChange = won ? amount : -amount;

            // 3. ATOMIC UPDATE
            const updatedUser = await User.findOneAndUpdate(
              { userId },
              { $inc: { gold: netChange } },
              { new: true },
            );

            const resultEmbed = new EmbedBuilder()
              .setTitle(won ? "🎉 CORRECT!" : "💀 WRONG")
              .setColor(won ? 0x2ecc71 : 0xe74c3c)
              .setDescription(
                `### Dealer: **${dealerCard}** vs Your Card: **${userCard}**\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\nResult: You chose **${choice.toUpperCase()}** and were **${won ? "Right" : "Wrong"}**!\n\n💰 **Change:** \`${netChange >= 0 ? "+" : ""}${netChange.toLocaleString()}\` gold\n🏦 **Balance:** \`${updatedUser.gold.toLocaleString()}\` gold`,
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

            // 4. LOG TO AUDIT
            await logToAudit(interaction.client, {
              userId: userId,
              bet: amount,
              amount: netChange,
              oldBalance: initialBalance,
              newBalance: updatedUser.gold,
              reason: `High-Low: ${choice.toUpperCase()} (Dealer: ${dealerCard} vs User: ${userCard})`,
            }).catch((err) => console.error("[AUDIT LOG ERROR]", err));

            // 5. REPEAT LOGIC COLLECTOR
            const endCollector = finalMsg.createMessageComponentCollector({
              componentType: ComponentType.Button,
              time: 15000,
            });

            endCollector.on("collect", async (btnInt) => {
              if (btnInt.user.id !== userId)
                return btnInt.reply({ content: "Not yours!", ephemeral: true });

              endCollector.stop();
              activeHighLow.delete(userId); // Clear lock before re-running

              if (btnInt.customId.startsWith("hl_rep_")) {
                return this.execute(btnInt, amount);
              }
              if (btnInt.customId === "hl_quit") {
                await btnInt.update({ components: [] });
              }
            });
          }, 3000);
          collector.stop();
        }
      });

      collector.on("end", (collected, reason) => {
        if (reason === "time") {
          activeHighLow.delete(userId);
          interaction.editReply({ components: [] }).catch(() => null);
        }
      });
    } catch (err) {
      console.error(err);
      activeHighLow.delete(userId);
    }
  },
};
