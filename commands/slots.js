const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const User = require("../models/User");
const { logToAudit } = require("../utils/logger");

const activeSlots = new Set();

module.exports = {
  name: "slots",
  async execute(interaction, repeatAmount = null) {
    const userId = interaction.user.id;
    const amount = repeatAmount ?? interaction.options.getInteger("amount");

    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply();
    }

    if (activeSlots.has(userId)) {
      return interaction.editReply({ content: "❌ Spin in progress!" });
    }

    try {
      // 1. Get pre-game data for the audit snapshot
      const userData = await User.findOne({ userId });
      if (!userData || userData.gold < amount) {
        return interaction.editReply({ content: "❌ Not enough gold!" });
      }

      const initialBalance = userData.gold; // Capture starting balance
      activeSlots.add(userId);

      const msg = await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("🎰 SPINNING...")
            .setImage(
              "https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExd2l6MzhjMGF0cW12aW9nOTlrdG1odnhjOHY0NnVna3VraHBmdGZsZCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/Ce18KspdcaxaKuZ1HC/giphy.gif",
            ),
        ],
      });

      // --- Math Logic ---
      const symbols = ["🍒", "🍋", "🍇", "🔔", "💎", "7️⃣"];
      const roll = Math.random() * 100;
      let r1,
        r2,
        r3,
        won = false,
        mult = 0;

      if (roll <= 1) {
        won = true;
        mult = 7;
        r1 = r2 = r3 = "7️⃣";
      } else if (roll <= 5) {
        won = true;
        mult = 3;
        r1 = r2 = r3 = "💎";
      } else if (roll <= 35) {
        won = true;
        mult = 1.5;
        const fruits = ["🍒", "🍋", "🍇", "🔔"];
        r1 = r2 = r3 = fruits[Math.floor(Math.random() * 4)];
      } else {
        won = false;
        r1 = symbols[Math.floor(Math.random() * 6)];
        r2 = symbols[Math.floor(Math.random() * 6)];
        r3 = symbols[Math.floor(Math.random() * 6)];
        if (r1 === r2 && r2 === r3) r3 = symbols[(symbols.indexOf(r3) + 1) % 6];
      }

      // --- Database Update ---
      const potentialWinnings = Math.floor(amount * mult);
      // We calculate the actual database change: if lost, -amount. If won, (Winnings - Bet).
      const dbChange = won ? potentialWinnings - amount : -amount;

      const updatedUser = await User.findOneAndUpdate(
        { userId },
        { $inc: { gold: dbChange } },
        { new: true },
      );

      // --- Visual Delay ---
      setTimeout(async () => {
        try {
          // 🛠️ LOGIC FIX: Determine netChange based on wallet difference (Horserace Style)
          const netChange = updatedUser.gold - initialBalance;

          const resultEmbed = new EmbedBuilder()
            .setTitle(won ? "🎉 WINNER!" : "💀 BUSTED")
            .setColor(won ? 0x2ecc71 : 0xe74c3c)
            .setDescription(
              `## [ ${r1} | ${r2} | ${r3} ]\n\nBalance: \`${updatedUser.gold.toLocaleString()}\` gold`,
            );

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`slots_rep_${amount}`)
              .setLabel("Spin Again")
              .setStyle(ButtonStyle.Success)
              .setDisabled(updatedUser.gold < amount),
            new ButtonBuilder()
              .setCustomId("slots_quit")
              .setLabel("Quit")
              .setStyle(ButtonStyle.Secondary),
          );

          await interaction.editReply({
            embeds: [resultEmbed],
            components: [row],
          });

          // --- LOGGING (Synced with Horserace Logic) ---
          await logToAudit(interaction.client, {
            userId,
            bet: amount,
            amount: netChange, // Correct signed integer (+/-)
            oldBalance: initialBalance,
            newBalance: updatedUser.gold,
            reason: `Slots: ${won ? "WIN" : "LOSS"} [${r1}${r2}${r3}]`,
          }).catch(() => null);

          // --- Collector ---
          const collector = msg.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 15000,
          });

          collector.on("collect", async (i) => {
            if (i.user.id !== userId)
              return i.reply({ content: "Not yours!", ephemeral: true });
            collector.stop();
            activeSlots.delete(userId);
            if (i.customId.startsWith("slots_rep_"))
              return this.execute(i, amount);
            await i.update({ components: [] });
          });

          collector.on("end", () => activeSlots.delete(userId));
        } catch (e) {
          console.error(e);
          activeSlots.delete(userId);
        }
      }, 2000);
    } catch (err) {
      console.error(err);
      activeSlots.delete(userId);
    }
  },
};
