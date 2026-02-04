const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const User = require("../models/User");
const { logToAudit } = require("../utils/logger");

const activeAviator = new Set();

module.exports = {
  name: "aviator",
  async execute(interaction) {
    // Removed repeatAmount parameter
    const userId = interaction.user.id;

    if (!interaction.replied && !interaction.deferred) {
      await interaction.deferReply();
    }

    const amount = interaction.options.getInteger("amount");

    if (activeAviator.has(userId)) {
      return interaction.editReply({
        content: "❌ You already have a flight in progress!",
        ephemeral: true,
      });
    }

    try {
      // 1. Database Check & Pre-game snapshot
      const userData = await User.findOne({ userId });
      if (!userData || userData.gold < amount) {
        return interaction.editReply({ content: "❌ Not enough gold!" });
      }

      const initialBalance = userData.gold;
      activeAviator.add(userId);
      const failSafe = setTimeout(() => activeAviator.delete(userId), 65000);

      // Deduct bet immediately
      await User.updateOne({ userId }, { $inc: { gold: -amount } });

      // 2. Game Logic (Crash Point)
      const roll = Math.random();
      let crashPoint;
      if (roll < 0.43) crashPoint = 1.2 + Math.random() * 0.3;
      else if (roll < 0.83) crashPoint = 1.5 + Math.random() * 0.5;
      else if (roll < 0.85) crashPoint = 2.0 + Math.random() * 8.0;
      else crashPoint = 1.0 + Math.random() * 0.2;

      crashPoint = parseFloat(crashPoint).toFixed(2);
      let currentMultiplier = 1.0;
      let gameActive = true;

      const createEmbed = (
        multiplier,
        status = "The plane is taking off...",
        color = 0x9b59b6,
      ) => {
        return new EmbedBuilder()
          .setTitle("✈️ AVIATOR: LUCKY JET")
          .setColor(color)
          .setDescription(
            `### Multiplier: \`${multiplier.toFixed(2)}x\`\n> ${status}`,
          )
          .addFields({
            name: "Potential Payout",
            value: `\`${Math.floor(amount * multiplier).toLocaleString()}\` gold`,
          })
          .setImage(
            "https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExeTRmenczcGU4eXNvbmxiNGtreDNmZnprczhjcGZqZzFnZzk0bmMyNSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/W307DdkjIsRHVWvoFE/giphy.gif",
          )
          .setFooter({
            text: `Bet: ${amount.toLocaleString()} | Don't let it fly away!`,
          });
      };

      const gameRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("cashout")
          .setLabel("CASH OUT")
          .setStyle(ButtonStyle.Success)
          .setEmoji("💰"),
      );

      const msg = await interaction.editReply({
        embeds: [createEmbed(currentMultiplier)],
        components: [gameRow],
      });

      const collector = msg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60000,
      });

      // 3. Game Loop
      const gameLoop = setInterval(async () => {
        if (!gameActive) return clearInterval(gameLoop);

        currentMultiplier += 0.05 + currentMultiplier * 0.02;

        if (currentMultiplier >= crashPoint) {
          gameActive = false;
          clearInterval(gameLoop);
          collector.stop("crashed");
          return;
        }

        await interaction
          .editReply({
            embeds: [createEmbed(currentMultiplier)],
          })
          .catch(() => {
            gameActive = false;
            clearInterval(gameLoop);
          });
      }, 2000);

      collector.on("collect", async (i) => {
        if (i.user.id !== userId)
          return i.reply({ content: "Not your flight!", ephemeral: true });
        gameActive = false;
        clearInterval(gameLoop);
        await i.deferUpdate();
        collector.stop("cashed_out");
      });

      collector.on("end", async (_, reason) => {
        clearTimeout(failSafe);
        activeAviator.delete(userId);

        let finalUser;
        let winAmount = 0;

        if (reason === "cashed_out") {
          winAmount = Math.floor(amount * currentMultiplier);
          finalUser = await User.findOneAndUpdate(
            { userId },
            { $inc: { gold: winAmount } },
            { new: true },
          );
        } else {
          finalUser = await User.findOne({ userId });
        }

        // Logic sync for Audit Log
        const netProfit = finalUser.gold - initialBalance;

        const endEmbed = new EmbedBuilder()
          .setTitle(reason === "cashed_out" ? "💰 PROFIT SECURED" : "🔥 KABOOM")
          .setColor(reason === "cashed_out" ? 0x2ecc71 : 0xe74c3c)
          .setDescription(
            reason === "cashed_out"
              ? `💵 **Exited at \`${currentMultiplier.toFixed(2)}x\`**\nProfit: \`+${netProfit.toLocaleString()}\` gold\n🏦 **Balance:** \`${finalUser.gold.toLocaleString()}\``
              : `💥 **Crashed at \`${crashPoint}x\`**\nLoss: \`-${amount.toLocaleString()}\` gold\n🏦 **Balance:** \`${finalUser.gold.toLocaleString()}\``,
          );

        // UI Fix: Removed the ActionRow with the "Fly Again" button
        await interaction
          .editReply({
            embeds: [endEmbed],
            components: [], // Empty components to clear buttons
          })
          .catch(() => null);

        // ✅ FINAL AUDIT LOG
        await logToAudit(interaction.client, {
          userId: userId,
          bet: amount,
          amount: netProfit,
          oldBalance: initialBalance,
          newBalance: finalUser.gold,
          reason: `Aviator: ${reason.toUpperCase()} (Multiplier: ${currentMultiplier.toFixed(2)}x)`,
        }).catch(() => null);
      });
    } catch (error) {
      console.error("Aviator Error:", error);
      activeAviator.delete(userId);
    }
  },
};
