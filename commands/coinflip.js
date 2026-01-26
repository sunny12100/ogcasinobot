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
const activeCoinflip = new Set();

module.exports = {
  name: "coinflip",
  async execute(interaction, repeatAmount = null) {
    const userId = interaction.user.id;

    // 1. DEFER & LOCK CHECK (Crucial for 10062 errors)
    if (!repeatAmount && !interaction.replied && !interaction.deferred) {
      await interaction.deferReply();
    }

    if (activeCoinflip.has(userId)) {
      const lockMsg = "❌ You already have a coin in the air!";
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
      activeCoinflip.add(userId);
      const failSafe = setTimeout(() => activeCoinflip.delete(userId), 20000);

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
          `👤 **Player:** <@${userId}>\n` +
            `💰 **Bet:** \`${amount.toLocaleString()}\` gold\n\n` +
            `Pick your side to flip the coin!`,
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

        const flippingEmbed = new EmbedBuilder()
          .setTitle("🪙 COIN IS IN THE AIR...")
          .setColor(0xffaa00)
          .setImage(
            "https://media0.giphy.com/media/v1.Y2lkPTc5MGI3NjExY3NyOHdrYmsydDhoNXN2cGNxajl2cnVqNmN2enBscm1oZHJuZHg4eCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/6jqfXikz9yzhS/giphy.gif",
          )
          .setDescription(`You chose **${choice.toUpperCase()}**!`);

        await i.update({ embeds: [flippingEmbed], components: [] });

        // Logic Delay
        setTimeout(async () => {
          clearTimeout(failSafe);
          activeCoinflip.delete(userId);

          // 45% win chance as per your original logic
          const won = Math.random() < 0.45;
          const resultSide = won
            ? choice
            : choice === "heads"
              ? "tails"
              : "heads";
          const netChange = won ? amount : -amount;

          // Atomic Balance Update
          const updatedUser = await User.findOneAndUpdate(
            { userId },
            { $inc: { gold: netChange } },
            { new: true },
          );

          const resultEmbed = new EmbedBuilder()
            .setTitle(won ? "🎉 WINNER!" : "💀 LOST")
            .setColor(won ? 0x2ecc71 : 0xe74c3c)
            .setThumbnail(
              won
                ? "https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExaWlxcDJpcTRwcjhhNXhoa254OXRhenhlNzduMG0yc2F2NmlxNDUwMCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/etKSrsbbKbqwW6vzOg/giphy.gif"
                : "https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExZG40ZDE5cG1zaW9yaTRjcnJkZWJwNjU3bjIxaHk1YXZ1MDR3ZTF0NiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/cr9vIO7NsP5cY/giphy.gif",
            )
            .setDescription(
              `### The coin landed on: **${resultSide.toUpperCase()}**\n` +
                `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n` +
                `You chose **${choice.toUpperCase()}** and **${won ? "won!" : "lost."}**\n\n` +
                `💰 **Change:** \`${netChange >= 0 ? "+" : ""}${netChange.toLocaleString()}\` gold\n` +
                `🏦 **New Balance:** \`${updatedUser.gold.toLocaleString()}\` gold\n` +
                `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
            );

          const repeatRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`cf_rep_${amount}`)
              .setLabel(`Flip Again (${amount})`)
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId("cf_quit")
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
            if (btn.customId.startsWith("cf_rep_")) {
              await btn.update({ components: [] }).catch(() => null);
              repeatCollector.stop();
              // Recursively call execute
              return module.exports.execute(btn, amount);
            }
            await btn.update({ components: [] });
            repeatCollector.stop();
          });

          logToAudit(interaction.client, {
            userId,
            amount: netChange,
            reason: `Coinflip: ${choice.toUpperCase()} (${won ? "Won" : "Lost"})`,
          }).catch(() => null);
        }, 2000);

        collector.stop();
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
