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

// 🔒 Memory lock to prevent double-games
const activeRoulette = new Set();

module.exports = {
  name: "roulette",
  async execute(interaction, repeatAmount = null) {
    const userId = interaction.user.id;

    // 1. DEFER & LOCK CHECK
    if (!repeatAmount && !interaction.replied && !interaction.deferred) {
      await interaction.deferReply();
    }

    if (activeRoulette.has(userId)) {
      const lockMsg = "❌ You already have a bet on the table!";
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
      activeRoulette.add(userId);
      const failSafe = setTimeout(() => activeRoulette.delete(userId), 45000);

      const menu = new StringSelectMenuBuilder()
        .setCustomId("roulette_bet")
        .setPlaceholder("📍 Place your bet on the table...")
        .addOptions([
          {
            label: "Red",
            value: "red",
            description: "Payout: 2x",
            emoji: "🔴",
          },
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
          {
            label: "Odd",
            value: "odd",
            description: "Payout: 2x",
            emoji: "🔢",
          },
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

      const response = await interaction.editReply({
        embeds: [initialEmbed],
        components: [new ActionRowBuilder().addComponents(menu)],
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
                `🎲 **${i.user.username}** bet \`${amount.toLocaleString()}\` on **${space.toUpperCase()}**`,
              ),
          ],
          components: [],
        });

        // 3. SPIN LOGIC
        setTimeout(async () => {
          clearTimeout(failSafe);
          activeRoulette.delete(userId);

          const rollType = Math.random() * 100;
          let resultColor, resultNumber;
          const redNumbers = [
            1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
          ];
          const blackNumbers = [
            2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35,
          ];

          // Probability Engine
          if (rollType <= 1) {
            // 1% Green
            resultColor = "green";
            resultNumber = Math.random() < 0.5 ? 0 : "00";
          } else if (rollType <= 48) {
            // 47% Hit user choice
            resultColor =
              space === "red" || space === "black"
                ? space
                : Math.random() < 0.5
                  ? "red"
                  : "black";

            if (space === "even")
              resultNumber = 2; // Simple representation
            else if (space === "odd") resultNumber = 3;
            else
              resultNumber =
                resultColor === "red" ? redNumbers[0] : blackNumbers[0];
          } else {
            // 52% House Win
            if (space === "red") {
              resultColor = "black";
              resultNumber = 2;
            } else if (space === "black") {
              resultColor = "red";
              resultNumber = 1;
            } else if (space === "even") {
              resultColor = "red";
              resultNumber = 3;
            } else if (space === "odd") {
              resultColor = "black";
              resultNumber = 4;
            } else {
              resultColor = "black";
              resultNumber = 2;
            }
          }

          // 4. WIN EVALUATION
          let won = false;
          let multiplier = 0;

          if (space === resultColor && resultColor !== "green") {
            won = true;
            multiplier = 2;
          } else if (
            space === "even" &&
            resultColor !== "green" &&
            parseInt(resultNumber) % 2 === 0
          ) {
            won = true;
            multiplier = 2;
          } else if (
            space === "odd" &&
            resultColor !== "green" &&
            parseInt(resultNumber) % 2 !== 0
          ) {
            won = true;
            multiplier = 2;
          } else if (space === "green" && resultColor === "green") {
            won = true;
            multiplier = 35;
          }

          const netChange = won ? amount * multiplier - amount : -amount;

          // Atomic Update
          const updatedUser = await User.findOneAndUpdate(
            { userId },
            { $inc: { gold: netChange } },
            { new: true },
          );

          const resultEmbed = new EmbedBuilder()
            .setTitle(won ? "✨ WINNER ✨" : "💀 HOUSE WINS")
            .setColor(won ? 0x2ecc71 : 0xe74c3c)
            .setDescription(
              `### Ball landed on: **${resultNumber} ${resultColor.toUpperCase()}**\n` +
                `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n` +
                `💰 **Change:** \`${netChange >= 0 ? "+" : ""}${netChange.toLocaleString()}\` gold\n` +
                `🏦 **Balance:** \`${updatedUser.gold.toLocaleString()}\` gold\n` +
                `▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
            );

          const repeatRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`roulette_rep_${amount}`)
              .setLabel(`Bet Again (${amount.toLocaleString()})`)
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

          // 5. REPEAT COLLECTOR
          const repeatCollector = finalMsg.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 15000,
          });

          repeatCollector.on("collect", async (btn) => {
            if (btn.user.id !== userId) return;
            if (btn.customId.startsWith("roulette_rep_")) {
              await btn.update({ components: [] }).catch(() => null);
              repeatCollector.stop();
              return module.exports.execute(btn, amount);
            }
            await btn.update({ components: [] });
            repeatCollector.stop();
          });

          logToAudit(interaction.client, {
            userId,
            amount: netChange,
            reason: `Roulette: ${space.toUpperCase()} (Ball: ${resultNumber} ${resultColor.toUpperCase()})`,
          }).catch(() => null);
        }, 3000);

        collector.stop();
      });

      collector.on("end", (collected, reason) => {
        if (reason === "time") {
          activeRoulette.delete(userId);
          interaction.editReply({ components: [] }).catch(() => null);
        }
      });
    } catch (err) {
      console.error(err);
      activeRoulette.delete(userId);
    }
  },
};
