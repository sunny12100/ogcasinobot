const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const User = require("../models/User");
const { logToAudit } = require("../utils/logger");

// 🔒 Memory lock to prevent double-games
const activeHighLow = new Set();

module.exports = {
  name: "highlow",
  async execute(interaction, repeatAmount = null) {
    const userId = interaction.user.id;

    // 1. DEFER & LOCK CHECK
    if (!repeatAmount && !interaction.replied && !interaction.deferred) {
      await interaction.deferReply();
    }

    if (activeHighLow.has(userId)) {
      const lockMsg = "❌ You already have a game in progress!";
      return repeatAmount
        ? interaction.followUp({ content: lockMsg, ephemeral: true })
        : interaction.editReply({ content: lockMsg });
    }

    const amount = repeatAmount ?? interaction.options.getInteger("amount");

    try {
      // 2. FETCH USER & VALIDATE
      const userData = await User.findOne({ userId });
      if (!userData || userData.gold < amount) {
        const err = `❌ Not enough gold! Balance: \`${userData?.gold?.toLocaleString() || 0}\``;
        return repeatAmount
          ? interaction.followUp({ content: err, ephemeral: true })
          : interaction.editReply({ content: err });
      }

      // Set Lock
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
          `👤 **Player:** <@${userId}>\n` +
            `💰 **Bet:** \`${amount.toLocaleString()}\` gold\n\n` +
            `The Dealer drew a: **[ ${dealerCard} ]**\n` +
            `Will the next card be **Higher** or **Lower**?`,
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
        const shufflingEmbed = new EmbedBuilder()
          .setTitle("🃏 SHUFFLING...")
          .setColor(0xffaa00)
          .setImage(
            "https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExcDJvZzRicXRqZnJiMjR0MXJ2ZGJhc2puN2JwbW43c21xaHg3NHJpNyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/bG5rDPx76wHMZtsXmr/giphy.gif",
          )
          .setDescription(
            `You bet **${choice.toUpperCase()}**! Let's see the card...`,
          );

        await i.update({ embeds: [shufflingEmbed], components: [] });

        // Logic Delay
        setTimeout(async () => {
          clearTimeout(failSafe);
          activeHighLow.delete(userId);

          const isLucky = Math.random() < 0.45; // 45% win chance
          let userIndex;

          if (isLucky) {
            if (choice === "higher") {
              userIndex =
                Math.floor(Math.random() * (cards.length - 1 - dealerIndex)) +
                (dealerIndex + 1);
            } else {
              userIndex = Math.floor(Math.random() * dealerIndex);
            }
          } else {
            if (choice === "higher")
              userIndex = Math.floor(Math.random() * (dealerIndex + 1));
            else
              userIndex =
                Math.floor(Math.random() * (cards.length - dealerIndex)) +
                dealerIndex;
          }

          const userCard = cards[userIndex];
          const won =
            (choice === "higher" && userIndex > dealerIndex) ||
            (choice === "lower" && userIndex < dealerIndex);
          const netChange = won ? amount : -amount;

          // Atomic Update
          const updatedUser = await User.findOneAndUpdate(
            { userId },
            { $inc: { gold: netChange } },
            { new: true },
          );

          const resultEmbed = new EmbedBuilder()
            .setTitle(won ? "🎉 CORRECT!" : "💀 WRONG")
            .setColor(won ? 0x2ecc71 : 0xe74c3c)
            .setThumbnail(
              won
                ? "https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExaWlxcDJpcTRwcjhhNXhoa254OXRhenhlNzduMG0yc2F2NmlxNDUwMCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/etKSrsbbKbqwW6vzOg/giphy.gif"
                : "https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExZG40ZDE5cG1zaW9yaTRjcnJkZWJwNjU3bjIxaHk1YXZ1MDR3ZTF0NiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/cr9vIO7NsP5cY/giphy.gif",
            )
            .setDescription(
              `### Dealer: **${dealerCard}** vs Your Card: **${userCard}**\n` +
                `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n` +
                `Result: You chose **${choice.toUpperCase()}** and were **${won ? "Right" : "Wrong"}**!\n\n` +
                `💰 **Change:** \`${netChange >= 0 ? "+" : ""}${netChange.toLocaleString()}\` gold\n` +
                `🏦 **New Balance:** \`${updatedUser.gold.toLocaleString()}\` gold\n` +
                `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
            );

          const repeatRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`hl_rep_${amount}`)
              .setLabel("Play Again")
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId("hl_quit")
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
            if (btn.customId.startsWith("hl_rep_")) {
              await btn.update({ components: [] }).catch(() => null);
              repeatCollector.stop();
              return module.exports.execute(btn, amount);
            }
            await btn.update({ components: [] });
            repeatCollector.stop();
          });

          logToAudit(interaction.client, {
            userId,
            amount: netChange,
            reason: `High-Low: ${choice.toUpperCase()} (Dealer: ${dealerCard} vs You: ${userCard})`,
          }).catch(() => null);
        }, 3000);

        collector.stop();
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
