const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const User = require("../models/User");
const { logToAudit } = require("../utils/logger");

module.exports = {
  name: "aviator",
  async execute(interaction, repeatAmount = null) {
    const amount = repeatAmount ?? interaction.options.getInteger("amount");
    const userId = interaction.user.id;

    const userData = await User.findOne({ userId });

    if (!userData) {
      const errorMsg =
        "❌ You are not registered! Please register in the casino-lobby first.";
      return interaction.replied || interaction.deferred
        ? interaction.followUp({ content: errorMsg, ephemeral: true })
        : interaction.reply({ content: errorMsg, ephemeral: true });
    }

    if (userData.gold < amount) {
      const errorMsg = `❌ Not enough gold! Balance: \`${userData.gold.toLocaleString()}\``;
      return interaction.replied || interaction.deferred
        ? interaction.followUp({ content: errorMsg, ephemeral: true })
        : interaction.reply({ content: errorMsg, ephemeral: true });
    }

    // --- GAME LOGIC (CUSTOM PROBABILITY SYSTEM) ---
    const roll = Math.random();
    let crashPoint;

    if (roll < 0.43) {
      // 43% → 1.2x to 1.5x
      crashPoint = 1.2 + Math.random() * 0.3;
    } else if (roll < 0.83) {
      // 40% → 1.5x to 2.0x
      crashPoint = 1.5 + Math.random() * 0.5;
    } else if (roll < 0.85) {
      // 2% → 2.0x to 10.0x
      crashPoint = 2.0 + Math.random() * 8.0;
    } else {
      // 15% → early crash (below 1.2x)
      crashPoint = 0.1 + Math.random() * 1.1;
    }

    crashPoint = crashPoint.toFixed(2);

    let currentMultiplier = 1.0;
    let gameActive = true;

    const gameRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("cashout")
        .setLabel("CASH OUT")
        .setStyle(ButtonStyle.Success)
        .setEmoji("💰"),
    );

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
          text: `Bet: ${amount.toLocaleString()} gold | Don't let it fly away!`,
        });
    };

    const msg =
      interaction.replied || interaction.deferred
        ? await interaction.editReply({
            embeds: [createEmbed(currentMultiplier)],
            components: [gameRow],
          })
        : await interaction.reply({
            embeds: [createEmbed(currentMultiplier)],
            components: [gameRow],
            fetchReply: true,
          });

    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 60000,
    });

    const gameLoop = setInterval(async () => {
      if (!gameActive) return clearInterval(gameLoop);

      currentMultiplier += 0.1 + currentMultiplier * 0.05;

      if (currentMultiplier >= crashPoint) {
        gameActive = false;
        clearInterval(gameLoop);
        collector.stop("crashed");
        return;
      }

      await interaction
        .editReply({ embeds: [createEmbed(currentMultiplier)] })
        .catch(() => {
          gameActive = false;
          clearInterval(gameLoop);
        });
    }, 1500);

    collector.on("collect", async (i) => {
      if (i.user.id !== userId)
        return i.reply({ content: "Not your flight!", ephemeral: true });

      gameActive = false;
      clearInterval(gameLoop);
      currentMultiplier = Math.max(1.0, currentMultiplier - 0.1);
      collector.stop("cashed_out");
      await i.deferUpdate();
    });

    collector.on("end", async (_, reason) => {
      const freshUserData = await User.findOne({ userId });
      let netChange = 0;

      if (reason === "cashed_out") {
        const winAmount = Math.floor(amount * currentMultiplier);
        netChange = winAmount - amount;
      } else {
        netChange = -amount;
      }

      freshUserData.gold += netChange;
      await freshUserData.save();

      await logToAudit(interaction.client, {
        userId,
        amount: netChange,
        reason:
          reason === "cashed_out"
            ? `Aviator @ ${currentMultiplier.toFixed(2)}x`
            : `Aviator Crash @ ${crashPoint}x`,
      });

      const endEmbed = new EmbedBuilder()
        .setTitle(reason === "cashed_out" ? "💰 PROFIT SECURED" : "🔥 KABOOM")
        .setColor(reason === "cashed_out" ? 0x2ecc71 : 0xe74c3c)
        .setDescription(
          `${
            reason === "cashed_out"
              ? `💵 **Exited at \`${currentMultiplier.toFixed(2)}x\`**`
              : `💥 **Crashed at \`${crashPoint}x\`**`
          }\n\n` +
            `**Net Change:** \`${netChange >= 0 ? "+" : ""}${netChange.toLocaleString()}\` gold\n` +
            `**New Balance:** \`${freshUserData.gold.toLocaleString()}\``,
        );

      const endRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`aviator_repeat_${amount}`)
          .setLabel(`Fly Again (${amount})`)
          .setStyle(ButtonStyle.Primary)
          .setEmoji("🛫"),
        new ButtonBuilder()
          .setCustomId("aviator_quit")
          .setLabel("Quit")
          .setStyle(ButtonStyle.Secondary),
      );

      const finalMsg = await interaction.editReply({
        embeds: [endEmbed],
        components: [endRow],
      });

      const repeatCollector = finalMsg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 15000,
      });

      repeatCollector.on("collect", async (btnInt) => {
        if (btnInt.user.id !== userId) return;
        if (btnInt.customId.startsWith("aviator_repeat_")) {
          await btnInt.deferUpdate();
          repeatCollector.stop();
          return this.execute(btnInt, amount);
        }
        await btnInt.update({ components: [] });
        repeatCollector.stop();
      });

      repeatCollector.on("end", (_, reason) => {
        if (reason === "time")
          interaction.editReply({ components: [] }).catch(() => null);
      });
    });
  },
};
