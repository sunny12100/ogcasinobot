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
  name: "coinflip",
  async execute(interaction, repeatAmount = null) {
    const amount = repeatAmount ?? interaction.options.getInteger("amount");
    const userId = interaction.user.id;

    // 1. STRICT VERIFICATION CHECK
    const users = loadUsers();
    if (!users[userId]) {
      const err =
        "❌ You are not verified! Please register in the casino-lobby first.";
      return interaction.replied || interaction.deferred
        ? interaction.followUp({ content: err, ephemeral: true })
        : interaction.reply({ content: err, ephemeral: true });
    }

    if (users[userId].balance < amount) {
      const err = `❌ Not enough gold! Balance: \`${users[userId].balance.toLocaleString()}\``;
      return interaction.replied || interaction.deferred
        ? interaction.followUp({ content: err, ephemeral: true })
        : interaction.reply({ content: err, ephemeral: true });
    }

    // --- GAME START ---
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

    const response =
      interaction.replied || interaction.deferred
        ? await interaction.editReply({
            embeds: [initialEmbed],
            components: [row],
          })
        : await interaction.reply({
            embeds: [initialEmbed],
            components: [row],
            fetchReply: true,
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

      setTimeout(async () => {
        // 45% win chance as per your original logic
        const winProbability = 0.45;
        const won = Math.random() < winProbability;
        const resultSide = won
          ? choice
          : choice === "heads"
            ? "tails"
            : "heads";

        const freshUsers = loadUsers();
        const netChange = won ? amount : -amount;
        freshUsers[userId].balance += netChange;
        saveUsers(freshUsers);

        // LOG TO AUDIT
        await logToAudit(interaction.client, {
          userId,
          amount: netChange,
          reason: `Coinflip (${choice} vs ${resultSide})`,
        });

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
              `🏦 **Balance:** \`${freshUsers[userId].balance.toLocaleString()}\` gold\n` +
              `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
          );

        // --- REPEAT BUTTONS ---
        const repeatRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`cf_repeat_${amount}`)
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
          if (btn.customId.startsWith("cf_repeat_")) {
            await btn.deferUpdate();
            repeatCollector.stop();
            return module.exports.execute(btn, amount);
          }
          await btn.update({ components: [] });
          repeatCollector.stop();
        });

        repeatCollector.on("end", (collected, reason) => {
          if (reason === "time")
            interaction.editReply({ components: [] }).catch(() => null);
        });
      }, 2000);
      collector.stop();
    });
  },
};
