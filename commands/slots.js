const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const User = require("../models/User");
const { logToAudit } = require("../utils/logger");

// 🔒 Memory lock to prevent multiple concurrent spins
const activeSlots = new Set();

module.exports = {
  name: "slots",
  async execute(interaction, repeatAmount = null) {
    const userId = interaction.user.id;

    // 1. DEFER & LOCK CHECK (Crucial for preventing 10062 errors)
    if (!repeatAmount && !interaction.replied && !interaction.deferred) {
      await interaction.deferReply();
    }

    if (activeSlots.has(userId)) {
      const lockMsg = "❌ The reels are already spinning! Wait for the result.";
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
      activeSlots.add(userId);
      // Failsafe to remove lock after 20 seconds if something crashes
      const failSafe = setTimeout(() => activeSlots.delete(userId), 20000);

      // 3. STARTING THE GAME (Visuals)
      const spinGif =
        "https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExd2l6MzhjMGF0cW12aW9nOTlrdG1odnhjOHY0NnVna3VraHBmdGZsZCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/Ce18KspdcaxaKuZ1HC/giphy.gif";

      const spinningEmbed = new EmbedBuilder()
        .setTitle("🎰 SPINNING...")
        .setColor(0xffaa00)
        .setImage(spinGif)
        .setDescription(`Betting **${amount.toLocaleString()}** gold!`);

      const response = await interaction.editReply({
        embeds: [spinningEmbed],
        components: [],
      });

      // 4. THE CALCULATION (Delayed for visual effect)
      setTimeout(async () => {
        clearTimeout(failSafe);
        activeSlots.delete(userId);

        const symbols = ["🍒", "🍋", "🍇", "🔔", "💎", "7️⃣"];
        const roll = Math.random() * 100;

        let r1, r2, r3;
        let won = false;
        let mult = 0;

        // --- PROBABILITY ENGINE ---
        if (roll <= 1) {
          // 7️⃣ JACKPOT (1%)
          won = true;
          mult = 7;
          r1 = r2 = r3 = "7️⃣";
        } else if (roll <= 5) {
          // 💎 WIN (4%)
          won = true;
          mult = 3;
          r1 = r2 = r3 = "💎";
        } else if (roll <= 35) {
          // 🍒 STANDARD WIN (30%)
          won = true;
          mult = 1.5;
          const fruits = ["🍒", "🍋", "🍇", "🔔"];
          r1 = r2 = r3 = fruits[Math.floor(Math.random() * fruits.length)];
        } else {
          // 💀 LOSS (65%)
          won = false;
          r1 = symbols[Math.floor(Math.random() * symbols.length)];
          r2 = symbols[Math.floor(Math.random() * symbols.length)];
          r3 = symbols[Math.floor(Math.random() * symbols.length)];
          // Ensure it's not a triple match
          if (r1 === r2 && r2 === r3) {
            r3 = symbols[(symbols.indexOf(r3) + 1) % symbols.length];
          }
        }

        const netChange = won ? Math.floor(amount * mult) - amount : -amount;

        // 5. ATOMIC DATABASE UPDATE
        const updatedUser = await User.findOneAndUpdate(
          { userId },
          { $inc: { gold: netChange } },
          { new: true },
        );

        const resultEmbed = new EmbedBuilder()
          .setTitle(won ? "🎉 WINNER!" : "💀 BUSTED")
          .setColor(won ? 0x2ecc71 : 0xe74c3c)
          .setDescription(
            `## [ ${r1} | ${r2} | ${r3} ]\n` +
              `▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n` +
              `${won ? `Won **${Math.floor(amount * mult).toLocaleString()}**` : `Lost **${amount.toLocaleString()}**`} gold\n\n` +
              `🏦 **New Balance:** \`${updatedUser.gold.toLocaleString()}\` gold`,
          );

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`slots_rep_${amount}`)
            .setLabel(`Spin Again (${amount})`)
            .setStyle(ButtonStyle.Success)
            .setDisabled(updatedUser.gold < amount),
          new ButtonBuilder()
            .setCustomId("slots_quit")
            .setLabel("Quit")
            .setStyle(ButtonStyle.Secondary),
        );

        const finalMsg = await interaction.editReply({
          embeds: [resultEmbed],
          components: [row],
        });

        // 6. REPEAT COLLECTOR
        const repeatCollector = finalMsg.createMessageComponentCollector({
          componentType: ComponentType.Button,
          time: 15000,
        });

        repeatCollector.on("collect", async (i) => {
          if (i.user.id !== userId)
            return i.reply({ content: "Not your game!", ephemeral: true });

          if (i.customId.startsWith("slots_rep_")) {
            await i.update({ components: [] }).catch(() => null);
            repeatCollector.stop();
            return module.exports.execute(i, amount);
          }

          if (i.customId === "slots_quit") {
            await i.update({ components: [] });
            repeatCollector.stop();
          }
        });

        repeatCollector.on("end", (collected, reason) => {
          if (reason === "time") {
            interaction.editReply({ components: [] }).catch(() => null);
          }
        });

        // LOG TO AUDIT
        logToAudit(interaction.client, {
          userId,
          amount: netChange,
          reason: won
            ? `Slots Win [${r1}${r2}${r3}]`
            : `Slots Loss [${r1}${r2}${r3}]`,
        }).catch(() => null);
      }, 2000);
    } catch (err) {
      console.error(err);
      activeSlots.delete(userId);
    }
  },
};
