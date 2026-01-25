const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const { logToAudit } = require("../utils/logger");
const User = require("../models/User"); // Import your Mongoose Model

module.exports = {
  name: "slots",
  async execute(interaction, repeatAmount = null) {
    const amount = repeatAmount ?? interaction.options.getInteger("amount");
    const userId = interaction.user.id;

    // 1. FETCH USER FROM MONGODB
    const userData = await User.findOne({ userId });

    // 2. VERIFICATION & BALANCE CHECK
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

    // 3. STARTING THE GAME (Visuals)
    const spinGif =
      "https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExd2l6MzhjMGF0cW12aW9nOTlrdG1odnhjOHY0NnVna3VraHBmdGZsZCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/Ce18KspdcaxaKuZ1HC/giphy.gif";

    const spinningEmbed = new EmbedBuilder()
      .setTitle("🎰 SPINNING...")
      .setColor(0xffaa00)
      .setImage(spinGif)
      .setDescription(`Betting **${amount.toLocaleString()}** gold!`);

    const response =
      interaction.replied || interaction.deferred
        ? await interaction.editReply({
            embeds: [spinningEmbed],
            components: [],
          })
        : await interaction.reply({
            embeds: [spinningEmbed],
            fetchReply: true,
          });

    // 4. THE CALCULATION
    setTimeout(async () => {
      const symbols = ["🍒", "🍋", "🍇", "🔔", "💎", "7️⃣"];
      const roll = Math.random() * 100; // Roll between 0.0 and 100.0

      let r1, r2, r3;
      let won = false;
      let mult = 0;

      if (roll <= 2) {
        // 🏆 SEVEN JACKPOT (2% Chance)
        won = true;
        mult = 10;
        r1 = r2 = r3 = "7️⃣";
      } else if (roll <= 7) {
        // 💎 DIAMOND WIN (5% Chance: 7 - 2 = 5)
        won = true;
        mult = 5;
        r1 = r2 = r3 = "💎";
      } else if (roll <= 37) {
        // 🍒 STANDARD WIN (30% Chance: 37 - 7 = 30)
        won = true;
        mult = 1.5;
        const fruits = ["🍒", "🍋", "🍇", "🔔"];
        r1 = r2 = r3 = fruits[Math.floor(Math.random() * fruits.length)];
      } else {
        // 💀 LOSS (63% Chance)
        won = false;
        r1 = symbols[Math.floor(Math.random() * symbols.length)];
        r2 = symbols[Math.floor(Math.random() * symbols.length)];
        r3 = symbols[Math.floor(Math.random() * symbols.length)];

        // Force a non-match if the random roll accidentally matched
        if (r1 === r2 && r2 === r3) {
          r3 = symbols[(symbols.indexOf(r3) + 1) % symbols.length];
        }
      }

      // 5. UPDATE MONGODB
      // Note: Math.floor used for 1.5x payouts to avoid decimal gold
      const netChange = won ? Math.floor(amount * mult) - amount : -amount;

      userData.gold += netChange;
      await userData.save();

      // 6. LOG TO AUDIT
      await logToAudit(interaction.client, {
        userId,
        amount: netChange,
        reason: won
          ? `Slots Win [${r1}${r2}${r3}]`
          : `Slots Loss [${r1}${r2}${r3}]`,
      }).catch((err) => console.error("Audit Log Error:", err));

      const resultEmbed = new EmbedBuilder()
        .setTitle(won ? "🎉 WINNER!" : "💀 BUSTED")
        .setColor(won ? 0x2ecc71 : 0xe74c3c)
        .setDescription(
          `## [ ${r1} | ${r2} | ${r3} ]\n` +
            `▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n` +
            `${won ? `Won **${Math.floor(amount * mult).toLocaleString()}**` : `Lost **${amount.toLocaleString()}**`}\n\n` +
            `🏦 **New Balance:** \`${userData.gold.toLocaleString()}\` gold`,
        );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`slots_repeat_${amount}`)
          .setLabel(`Spin Again (${amount})`)
          .setStyle(ButtonStyle.Success)
          .setDisabled(userData.gold < amount),
        new ButtonBuilder()
          .setCustomId("slots_end")
          .setLabel("Quit")
          .setStyle(ButtonStyle.Danger),
      );

      await interaction.editReply({ embeds: [resultEmbed], components: [row] });

      const collector = response.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 15000,
      });

      collector.on("collect", async (i) => {
        if (i.user.id !== userId)
          return i.reply({ content: "Start your own game!", ephemeral: true });

        if (i.customId.startsWith("slots_repeat_")) {
          await i.deferUpdate();
          collector.stop();
          return module.exports.execute(i, amount);
        }

        if (i.customId === "slots_end") {
          await i.update({ components: [] });
          collector.stop();
        }
      });

      collector.on("end", (collected, reason) => {
        if (reason === "time")
          interaction.editReply({ components: [] }).catch(() => null);
      });
    }, 2000);
  },
};
