const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const { logToAudit } = require("../utils/logger");
const { loadUsers, saveUsers } = require("../utils/db");

module.exports = {
  name: "aviator",
  async execute(interaction, repeatAmount = null) {
    const amount = repeatAmount ?? interaction.options.getInteger("amount");
    const userId = interaction.user.id;

    // 1. STRICT VERIFICATION CHECK
    const users = loadUsers();
    if (!users[userId]) {
      const errorMsg =
        "❌ You are not verified! Please register in the casino-lobby first.";
      return interaction.replied || interaction.deferred
        ? interaction.followUp({ content: errorMsg, ephemeral: true })
        : interaction.reply({ content: errorMsg, ephemeral: true });
    }

    if (users[userId].balance < amount) {
      const errorMsg = `❌ Not enough gold! Balance: \`${users[userId].balance.toLocaleString()}\``;
      return interaction.replied || interaction.deferred
        ? interaction.followUp({ content: errorMsg, ephemeral: true })
        : interaction.reply({ content: errorMsg, ephemeral: true });
    }

    // --- GAME LOGIC ---
    const crashPoint = Math.max(
      1,
      Math.random() * (Math.random() < 0.1 ? 10 : 3) + 0.1,
    ).toFixed(2);

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

    // Handle initial reply or update from previous "Repeat" button
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
      if (i.user.id !== interaction.user.id)
        return i.reply({ content: "Not your flight!", ephemeral: true });

      gameActive = false;
      clearInterval(gameLoop);
      // Small "lag" compensation: reduce multiplier slightly on cashout
      currentMultiplier = Math.max(1.0, currentMultiplier - 0.1);
      collector.stop("cashed_out");
      await i.deferUpdate(); // Prevents "interaction failed" on button click
    });

    collector.on("end", async (_, reason) => {
      const freshUsers = loadUsers();
      let netChange = 0;

      if (reason === "cashed_out") {
        const winAmount = Math.floor(amount * currentMultiplier);
        netChange = winAmount - amount;
        freshUsers[userId].balance += netChange;
      } else {
        netChange = -amount;
        freshUsers[userId].balance += netChange;
      }

      saveUsers(freshUsers);

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
          `${reason === "cashed_out" ? `💵 **Exited at \`${currentMultiplier.toFixed(2)}x\`**` : `💥 **Crashed at \`${crashPoint}x\`**`}\n\n` +
            `**Net Change:** \`${netChange >= 0 ? "+" : ""}${netChange.toLocaleString()}\` gold\n` +
            `**Balance:** \`${freshUsers[userId].balance.toLocaleString()}\``,
        )
        .setThumbnail(
          reason === "cashed_out"
            ? "https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExM2J4bjdjbjNrYjl2bWc4b2N2c3RjZnZzaWhmdWRoZGd4cWdtd2x2NyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/h0MTqLyvgG0Ss/giphy.gif"
            : "https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExanN5ZHNpZ2RxZm4zanR0NDdjMGo2cmNnZ290emp0N3lxandqbGFiOCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/oe33xf3B50fsc/giphy.gif",
        );

      // --- ADD REPEAT BUTTONS ---
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

      // --- SECOND COLLECTOR FOR THE REPEAT ACTION ---
      const repeatCollector = finalMsg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 15000,
      });

      repeatCollector.on("collect", async (btnInt) => {
        if (btnInt.user.id !== interaction.user.id) return;

        if (btnInt.customId.startsWith("aviator_repeat_")) {
          await btnInt.deferUpdate();
          repeatCollector.stop();
          return this.execute(btnInt, amount); // Recursive call
        }

        if (btnInt.customId === "aviator_quit") {
          await btnInt.update({ components: [] });
          repeatCollector.stop();
        }
      });

      repeatCollector.on("end", (collected, reason) => {
        if (reason === "time")
          interaction.editReply({ components: [] }).catch(() => null);
      });
    });
  },
};
