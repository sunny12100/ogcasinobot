const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const { logToAudit } = require("../utils/logger");
const { loadUsers, saveUsers } = require("../utils/db");

module.exports = {
  name: "roulette",
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

    // --- BETTING MENU ---
    const menu = new StringSelectMenuBuilder()
      .setCustomId("roulette_bet")
      .setPlaceholder("📍 Place your bet on the table...")
      .addOptions([
        { label: "Red", value: "red", description: "Payout: 2x", emoji: "🔴" },
        {
          label: "Black",
          value: "black",
          description: "Payout: 2x",
          emoji: "⚫",
        },
        {
          label: "Even",
          value: "even",
          description: "Payout: 2x",
          emoji: "🔢",
        },
        { label: "Odd", value: "odd", description: "Payout: 2x", emoji: "🔢" },
        {
          label: "Green",
          value: "green",
          description: "Payout: 18x",
          emoji: "🟢",
        },
      ]);

    const initialEmbed = new EmbedBuilder()
      .setTitle("🎰 ROULETTE TABLE")
      .setColor(0xffaa00)
      .setImage(
        "https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExcTRzYnljc3ozbzk5cG9xb2ozNDNrczR5bDJ1OXdkOXR2OXd5aDlvdSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/26uflBhaGt5lQsaCA/giphy.gif",
      )
      .setDescription(
        `👤 **Player:** <@${userId}>\n` +
          `💰 **Bet Amount:** \`${amount.toLocaleString()}\` gold\n\n` +
          `*Select an option below to spin the wheel!*`,
      );

    const response =
      interaction.replied || interaction.deferred
        ? await interaction.editReply({
            embeds: [initialEmbed],
            components: [new ActionRowBuilder().addComponents(menu)],
          })
        : await interaction.reply({
            embeds: [initialEmbed],
            components: [new ActionRowBuilder().addComponents(menu)],
            fetchReply: true,
          });

    const collector = response.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      time: 30000,
    });

    collector.on("collect", async (i) => {
      if (i.user.id !== userId)
        return i.reply({ content: "Not your game!", ephemeral: true });

      const space = i.values[0];

      const spinningEmbed = new EmbedBuilder()
        .setTitle("🎰 WHEEL IS SPINNING...")
        .setColor(0xffaa00)
        .setThumbnail(
          "https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExbnI2Z254b3dzNjhzemtnZndiZDBqcmxhZGtxaHIzdmhoMXU1cXp3dSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/GWS8bXKxphfEI/giphy.gif",
        )
        .setDescription(
          `🎲 **${i.user.username}** placed \`${amount}\` on **${space.toUpperCase()}**\n\n*Waiting for the ball to land...*`,
        );

      await i.update({ embeds: [spinningEmbed], components: [] });

      setTimeout(async () => {
        const roll = Math.floor(Math.random() * 38); // 0-36 + 37 (Double Zero)
        const resultText = roll === 37 ? "00" : roll.toString();
        const redNumbers = [
          1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
        ];

        let resultColor =
          roll === 0 || roll === 37
            ? "green"
            : redNumbers.includes(roll)
              ? "red"
              : "black";

        let won = false;
        let multiplier = 0;

        // Win Logic
        if (space === resultColor && resultColor !== "green") {
          won = true;
          multiplier = 2;
        } else if (
          space === "even" &&
          roll !== 0 &&
          roll !== 37 &&
          roll % 2 === 0
        ) {
          won = true;
          multiplier = 2;
        } else if (
          space === "odd" &&
          roll !== 0 &&
          roll !== 37 &&
          roll % 2 !== 0
        ) {
          won = true;
          multiplier = 2;
        } else if (space === "green" && resultColor === "green") {
          won = true;
          multiplier = 18;
        }

        const freshUsers = loadUsers();
        const netChange = won ? amount * multiplier - amount : -amount;
        freshUsers[userId].balance += netChange;
        saveUsers(freshUsers);

        // LOG TO AUDIT
        await logToAudit(interaction.client, {
          userId,
          amount: netChange,
          reason: `Roulette: ${space} (Landed ${resultText} ${resultColor})`,
        });

        const resultEmbed = new EmbedBuilder()
          .setTitle(won ? "✨ WINNER ✨" : "💀 HOUSE WINS")
          .setColor(won ? 0x2ecc71 : 0xe74c3c)
          .setImage(
            won
              ? "https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExaWlxcDJpcTRwcjhhNXhoa254OXRhenhlNzduMG0yc2F2NmlxNDUwMCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/etKSrsbbKbqwW6vzOg/giphy.gif"
              : "https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExZG40ZDE5cG1zaW9yaTRjcnJkZWJwNjU3bjIxaHk1YXZ1MDR3ZTF0NiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/cr9vIO7NsP5cY/giphy.gif",
          )
          .setDescription(
            `### The ball landed on: **${resultText} ${resultColor.toUpperCase()}**\n` +
              `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n` +
              `💰 **Change:** \`${netChange >= 0 ? "+" : ""}${netChange.toLocaleString()}\` gold\n` +
              `🏦 **Balance:** \`${freshUsers[userId].balance.toLocaleString()}\` gold\n` +
              `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
          );

        // --- REPEAT BUTTONS ---
        const repeatRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`roulette_repeat_${amount}`)
            .setLabel(`Bet Again (${amount})`)
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId("roulette_quit")
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
          if (btn.customId.startsWith("roulette_repeat_")) {
            await btn.deferUpdate();
            repeatCollector.stop();
            return module.exports.execute(btn, amount);
          }
          await btn.update({ components: [] });
          repeatCollector.stop();
        });
      }, 3000);
      collector.stop();
    });
  },
};
