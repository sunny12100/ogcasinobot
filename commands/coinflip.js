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

module.exports = {
  name: "coinflip",
  async execute(interaction, repeatAmount = null) {
    const userId = interaction.user.id;
    const amount = repeatAmount ?? interaction.options.getInteger("amount");

    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply();
    }

    if (activeCoinflip.has(userId)) {
      const lockMsg = "❌ You already have a coin in the air!";
      return interaction.editReply({ content: lockMsg });
    }

    try {
      const userData = await User.findOne({ userId });
      if (!userData || userData.gold < amount) {
        const err = `❌ Not enough gold! Balance: \`${userData?.gold?.toLocaleString() || 0}\``;
        return interaction.editReply({ content: err });
      }

      const initialBalance = userData.gold;
      activeCoinflip.add(userId);
      const failSafe = setTimeout(() => activeCoinflip.delete(userId), 30000);

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
          `👤 **Player:** <@${userId}>\n💰 **Bet:** \`${amount.toLocaleString()}\` gold\n\nPick a side!`,
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
        // Check if user clicked Heads/Tails (Initial choice)
        if (choice === "heads" || choice === "tails") {
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

          setTimeout(async () => {
            clearTimeout(failSafe);
            activeCoinflip.delete(userId);

            const won = Math.random() < 0.45; // 45% win rate
            const resultSide = won
              ? choice
              : choice === "heads"
                ? "tails"
                : "heads";
            const netChange = won ? amount : -amount;

            const updatedUser = await User.findOneAndUpdate(
              { userId },
              { $inc: { gold: netChange } },
              { new: true },
            );

            const resultEmbed = new EmbedBuilder()
              .setTitle(won ? "🎉 WINNER!" : "💀 LOST")
              .setColor(won ? 0x2ecc71 : 0xe74c3c)
              .setDescription(
                `### The coin landed on: **${resultSide.toUpperCase()}**\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\nYou chose **${choice.toUpperCase()}** and **${won ? "won!" : "lost."}**\n\n💰 **Change:** \`${netChange >= 0 ? "+" : ""}${netChange.toLocaleString()}\` gold\n🏦 **Balance:** \`${updatedUser.gold.toLocaleString()}\` gold`,
              );

            const repeatRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`cf_rep_${amount}`)
                .setLabel(`Flip Again`)
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

            // --- LOGGING ---
            await logToAudit(interaction.client, {
              userId: userId,
              bet: amount,
              amount: netChange,
              oldBalance: initialBalance,
              newBalance: updatedUser.gold,
              reason: `Coinflip: ${choice.toUpperCase()} (${won ? "Won" : "Lost"})`,
            }).catch(() => null);

            // --- SECONDARY COLLECTOR FOR REPEAT/QUIT ---
            const endCollector = finalMsg.createMessageComponentCollector({
              componentType: ComponentType.Button,
              time: 15000,
            });

            endCollector.on("collect", async (btnInt) => {
              if (btnInt.user.id !== userId)
                return btnInt.reply({
                  content: "Not your game!",
                  ephemeral: true,
                });

              endCollector.stop();
              activeCoinflip.delete(userId);

              if (btnInt.customId.startsWith("cf_rep_")) {
                return this.execute(btnInt, amount);
              }

              if (btnInt.customId === "cf_quit") {
                await btnInt.update({ components: [] });
              }
            });
          }, 2000);
          collector.stop();
        }
      });

      collector.on("end", (collected, reason) => {
        if (reason === "time") {
          activeCoinflip.delete(userId);
          interaction.editReply({ components: [] }).catch(() => null);
        }
      });
    } catch (err) {
      console.error(err);
      activeCoinflip.delete(userId);
    }
  },
};
