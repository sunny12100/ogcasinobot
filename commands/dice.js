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
  name: "dice",
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
          `Dealer rolled: **${diceEmojis[dealerRoll]} (${dealerRoll})**\n` +
          `Will the next roll be **Higher** or **Lower**?`,
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

      const rollingEmbed = new EmbedBuilder()
        .setTitle("🎲 ROLLING...")
        .setColor(0xffaa00)
        .setImage(
          "https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExbDg5MGR2czlqYzc5ZWljdXNtYTUxN295ZXBlcWdvbDF3aTB3aGF3ZiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/0mkK0hzJmL69KInkIZ/giphy.gif",
        )
        .setDescription(`You bet **${choice.toUpperCase()}**!`);

      await i.update({ embeds: [rollingEmbed], components: [] });

      setTimeout(async () => {
        const isLucky = Math.random() < 0.45; // 45% win probability
        let userRoll;

        // Forced Outcome Logic for House Edge
        if (isLucky) {
          if (choice === "higher" && dealerRoll < 12)
            userRoll =
              Math.floor(Math.random() * (12 - dealerRoll)) + (dealerRoll + 1);
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

        const freshUsers = loadUsers();
        const netChange = actuallyWon ? amount : -amount;
        freshUsers[userId].balance += netChange;
        saveUsers(freshUsers);

        await logToAudit(interaction.client, {
          userId,
          amount: netChange,
          reason: `Dice: Dealer ${dealerRoll} vs User ${userRoll}`,
        });

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
              `🏦 **Balance:** \`${freshUsers[userId].balance.toLocaleString()}\` gold\n` +
              `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
          );

        // --- REPEAT BUTTONS ---
        const repeatRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`dice_repeat_${amount}`)
            .setLabel(`Roll Again (${amount})`)
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

        const repeatCollector = finalMsg.createMessageComponentCollector({
          componentType: ComponentType.Button,
          time: 15000,
        });

        repeatCollector.on("collect", async (btn) => {
          if (btn.user.id !== userId) return;
          if (btn.customId.startsWith("dice_repeat_")) {
            await btn.deferUpdate();
            repeatCollector.stop();
            return module.exports.execute(btn, amount);
          }
          await btn.update({ components: [] });
          repeatCollector.stop();
        });
      }, 2000);
      collector.stop();
    });
  },
};
