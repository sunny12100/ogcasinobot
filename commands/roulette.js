const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const User = require("../models/User");
const { logToAudit } = require("../utils/logger");

module.exports = {
  name: "roulette",
  async execute(interaction, repeatAmount = null) {
    const amount = repeatAmount ?? interaction.options.getInteger("amount");
    const userId = interaction.user.id;

    const userData = await User.findOne({ userId });
    if (!userData) {
      const err =
        "❌ You are not registered! Please use the registration panel first.";
      return interaction.reply({ content: err, ephemeral: true });
    }

    if (userData.gold < amount) {
      const err = `❌ Not enough gold! Balance: \`${userData.gold.toLocaleString()}\``;
      return interaction.reply({ content: err, ephemeral: true });
    }

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
          description: "Payout: 35x",
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
        `👤 **Player:** <@${userId}>\n💰 **Bet Amount:** \`${amount.toLocaleString()}\` gold\n\n*Select an option to spin!*`,
      );

    const response = await interaction.reply({
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
      await i.update({
        embeds: [
          new EmbedBuilder()
            .setTitle("🎰 WHEEL IS SPINNING...")
            .setColor(0xffaa00)
            .setDescription(
              `🎲 **${i.user.username}** bet \`${amount}\` on **${space.toUpperCase()}**`,
            ),
        ],
        components: [],
      });

      setTimeout(async () => {
        const rollType = Math.random() * 100; // 0.0 to 100.0
        let resultColor, resultNumber;
        const redNumbers = [
          1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
        ];

        // --- PROBABILITY ENGINE ---
        if (rollType <= 1) {
          // 🟢 1% GREEN WIN
          resultColor = "green";
          resultNumber = Math.random() < 0.5 ? 0 : "00";
        } else if (rollType <= 48) {
          // 🔴⚫ 47% CHANCE TO HIT USER'S COLOR/TYPE
          // Logic: If user picked red, give red. If user picked black, give black.
          // If user picked Even/Odd, give a matching number.
          if (space === "red") resultColor = "red";
          else if (space === "black") resultColor = "black";
          else if (space === "even")
            resultColor = Math.random() < 0.5 ? "red" : "black";
          else if (space === "odd")
            resultColor = Math.random() < 0.5 ? "red" : "black";
          else resultColor = "red"; // Default fallthrough

          // Generate a number that matches the color/parity logic
          resultNumber =
            resultColor === "red"
              ? redNumbers[Math.floor(Math.random() * redNumbers.length)]
              : 2;
        } else {
          // 💀 52% HOUSE WIN (Opposite of user's bet)
          resultColor = space === "red" ? "black" : "red";
          resultNumber = 13; // Example losing number
        }

        // --- WIN CHECK ---
        let won = false;
        let multiplier = 0;

        if (space === resultColor && resultColor !== "green") {
          won = true;
          multiplier = 2;
        } else if (
          space === "even" &&
          resultNumber !== "green" &&
          parseInt(resultNumber) % 2 === 0
        ) {
          won = true;
          multiplier = 2;
        } else if (
          space === "odd" &&
          resultNumber !== "green" &&
          parseInt(resultNumber) % 2 !== 0
        ) {
          won = true;
          multiplier = 2;
        } else if (space === "green" && resultColor === "green") {
          won = true;
          multiplier = 35;
        }

        const netChange = won ? amount * multiplier - amount : -amount;
        userData.gold += netChange;
        await userData.save();

        await logToAudit(interaction.client, {
          userId,
          amount: netChange,
          reason: `Roulette: ${space.toUpperCase()} (Ball: ${resultNumber} ${resultColor.toUpperCase()})`,
        }).catch(() => null);

        const resultEmbed = new EmbedBuilder()
          .setTitle(won ? "✨ WINNER ✨" : "💀 HOUSE WINS")
          .setColor(won ? 0x2ecc71 : 0xe74c3c)
          .setDescription(
            `### Ball landed on: **${resultNumber} ${resultColor.toUpperCase()}**\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n💰 **Change:** \`${netChange >= 0 ? "+" : ""}${netChange.toLocaleString()}\` gold\n🏦 **Balance:** \`${userData.gold.toLocaleString()}\` gold\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
          );

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

        await interaction.editReply({
          embeds: [resultEmbed],
          components: [repeatRow],
        });
      }, 3000);
      collector.stop();
    });
  },
};
