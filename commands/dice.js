const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const User = require("../models/User");
const { logToAudit } = require("../utils/logger");

// 🔒 Memory lock to prevent multiple concurrent games
const activeDice = new Set();

module.exports = {
  name: "dice",
  async execute(interaction, repeatAmount = null) {
    const userId = interaction.user.id;

    // 1. DEFER & LOCK CHECK
    if (!repeatAmount && !interaction.replied && !interaction.deferred) {
      await interaction.deferReply();
    }

    if (activeDice.has(userId)) {
      const lockMsg = "❌ You are already rolling the dice!";
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
      activeDice.add(userId);
      const failSafe = setTimeout(() => activeDice.delete(userId), 25000);

      // --- GAME CONFIG ---
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
          `👤 **Player:** <@${userId}>\n` +
            `💰 **Bet:** \`${amount.toLocaleString()}\` gold\n\n` +
            `Dealer rolled: **${diceEmojis[dealerRoll] || "🎲🎲"} (${dealerRoll})**\n` +
            `Will the next roll be **Higher** or **Lower**?`,
        );

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
        const rollingEmbed = new EmbedBuilder()
          .setTitle("🎲 ROLLING...")
          .setColor(0xffaa00)
          .setImage(
            "https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExbDg5MGR2czlqYzc5ZWljdXNtYTUxN295ZXBlcWdvbDF3aTB3aGF3ZiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/0mkK0hzJmL69KInkIZ/giphy.gif",
          )
          .setDescription(`You bet **${choice.toUpperCase()}**!`);

        await i.update({ embeds: [rollingEmbed], components: [] });

        // Rolling Delay (2 Seconds)
        setTimeout(async () => {
          clearTimeout(failSafe);
          activeDice.delete(userId);

          const isLucky = Math.random() < 0.45; // 45% win probability
          let userRoll;

          // Logic to ensure house edge
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

          // Atomic Update: Update gold and fetch new balance in one go
          const updatedUser = await User.findOneAndUpdate(
            { userId },
            { $inc: { gold: netChange } },
            { new: true },
          );

          const resultEmbed = new EmbedBuilder()
            .setTitle(actuallyWon ? "🎉 YOU WON!" : "💀 HOUSE WINS")
            .setColor(actuallyWon ? 0x2ecc71 : 0xe74c3c)
            .setThumbnail(
              actuallyWon
                ? "https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExaWlxcDJpcTRwcjhhNXhoa254OXRhenhlNzduMG0yc2F2NmlxNDUwMCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/etKSrsbbKbqwW6vzOg/giphy.gif"
                : "https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExZG40ZDE5cG1zaW9yaTRjcnJkZWJwNjU3bjIxaHk1YXZ1MDR3ZTF0NiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/cr9vIO7NsP5cY/giphy.gif",
            )
            .setDescription(
              `### Dealer: **${dealerRoll}** vs You: **${userRoll}**\n` +
                `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n` +
                `The dice show: **${diceEmojis[userRoll] || "🎲🎲"}**\n` +
                `Result: You chose **${choice.toUpperCase()}** and **${actuallyWon ? "Won" : "Lost"}**\n\n` +
                `💰 **Change:** \`${netChange >= 0 ? "+" : ""}${netChange.toLocaleString()}\` gold\n` +
                `🏦 **New Balance:** \`${updatedUser.gold.toLocaleString()}\` gold\n` +
                `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
            );

          const repeatRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`dice_rep_${amount}`)
              .setLabel("Roll Again")
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId("dice_quit")
              .setLabel("Quit")
              .setStyle(ButtonStyle.Secondary),
          );

          const finalMsg = await interaction.editReply({
            embeds: [resultEmbed],
            components: [repeatRow],
          });

          // --- REPEAT COLLECTOR ---
          const repeatCollector = finalMsg.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 15000,
          });

          repeatCollector.on("collect", async (btn) => {
            if (btn.user.id !== userId) return;
            if (btn.customId.startsWith("dice_rep_")) {
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
            reason: `Dice: Bet ${choice.toUpperCase()} (Dealer: ${dealerRoll} vs You: ${userRoll})`,
          }).catch(() => null);
        }, 2000);

        collector.stop();
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
