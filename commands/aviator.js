const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const User = require("../models/User");
const { logToAudit } = require("../utils/logger");

// 🔒 Global Lock for Aviator
const activeAviator = new Set();

module.exports = {
  name: "aviator",
  async execute(interaction, repeatAmount = null) {
    const userId = interaction.user.id;

    // 1. Handle Deferral (Prevents 10062 error)
    // If it's a repeat, the button was already deferred/updated
    if (!repeatAmount && !interaction.replied && !interaction.deferred) {
      await interaction.deferReply();
    }

    const amount = repeatAmount ?? interaction.options.getInteger("amount");

    // 2. Double Play Prevention
    if (activeAviator.has(userId)) {
      const lockMsg = "❌ You already have a flight in progress!";
      return repeatAmount
        ? interaction.followUp({ content: lockMsg, ephemeral: true })
        : interaction.editReply({ content: lockMsg });
    }

    try {
      // 3. Database Check
      const userData = await User.findOne({ userId });
      if (!userData || userData.gold < amount) {
        const goldMsg = "❌ Not enough gold!";
        return repeatAmount
          ? interaction.followUp({ content: goldMsg, ephemeral: true })
          : interaction.editReply({ content: goldMsg });
      }

      // 4. Set Lock & Initial Deduction
      activeAviator.add(userId);
      const failSafe = setTimeout(() => activeAviator.delete(userId), 65000);

      await User.updateOne({ userId }, { $inc: { gold: -amount } });

      // 5. Game Logic
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
        fetchReply: true,
      });

      const collector = msg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60000,
      });

      // 6. Smooth Game Loop
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
        collector.stop("cashed_out");
        await i.deferUpdate();
      });

      collector.on("end", async (_, reason) => {
        clearTimeout(failSafe);
        activeAviator.delete(userId);

        let winAmount = 0;
        if (reason === "cashed_out") {
          winAmount = Math.floor(amount * currentMultiplier);
          await User.updateOne({ userId }, { $inc: { gold: winAmount } });
        }

        const endEmbed = new EmbedBuilder()
          .setTitle(reason === "cashed_out" ? "💰 PROFIT SECURED" : "🔥 KABOOM")
          .setColor(reason === "cashed_out" ? 0x2ecc71 : 0xe74c3c)
          .setDescription(
            reason === "cashed_out"
              ? `💵 **Exited at \`${currentMultiplier.toFixed(2)}x\`**\nWin: \`+${(winAmount - amount).toLocaleString()}\` gold`
              : `💥 **Crashed at \`${crashPoint}x\`**\nLoss: \`-${amount.toLocaleString()}\` gold`,
          );

        const endRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`avi_rep_${amount}`)
            .setLabel("Fly Again")
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId("avi_quit")
            .setLabel("Quit")
            .setStyle(ButtonStyle.Secondary),
        );

        const finalResponse = await interaction.editReply({
          embeds: [endEmbed],
          components: [endRow],
        });

        // --- FLY AGAIN COLLECTOR ---
        const repeatCollector = finalResponse.createMessageComponentCollector({
          componentType: ComponentType.Button,
          time: 15000,
        });

        repeatCollector.on("collect", async (btnInt) => {
          if (btnInt.user.id !== userId) return;

          if (btnInt.customId.startsWith("avi_rep_")) {
            await btnInt.update({ components: [] }).catch(() => null);
            repeatCollector.stop();
            // Restarts the function
            return module.exports.execute(btnInt, amount);
          }

          if (btnInt.customId === "avi_quit") {
            await btnInt.update({ components: [] }).catch(() => null);
            repeatCollector.stop();
          }
        });

        logToAudit(interaction.client, {
          userId,
          amount: reason === "cashed_out" ? winAmount - amount : -amount,
          reason: `Aviator ${reason}`,
        }).catch(() => null);
      });
    } catch (error) {
      console.error("Aviator Error:", error);
      activeAviator.delete(userId);
      if (interaction.deferred || interaction.replied) {
        await interaction
          .editReply({ content: "❌ An error occurred." })
          .catch(() => null);
      }
    }
  },
};
