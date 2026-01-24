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
      const winProbability = 0.42; // Adjusted house edge
      const isLucky = Math.random() < winProbability;

      let r1, r2, r3;
      if (isLucky) {
        r1 = r2 = r3 = symbols[Math.floor(Math.random() * symbols.length)];
      } else {
        r1 = symbols[Math.floor(Math.random() * symbols.length)];
        r2 = symbols[Math.floor(Math.random() * symbols.length)];
        r3 = symbols[Math.floor(Math.random() * symbols.length)];
        // Ensure they aren't all the same if "not lucky"
        if (r1 === r2 && r2 === r3)
          r3 = symbols[(symbols.indexOf(r3) + 1) % symbols.length];
      }

      const won = r1 === r2 && r2 === r3;
      const mult = won ? (r1 === "7️⃣" ? 10 : r1 === "💎" ? 5 : 3) : 0;

      // 5. UPDATE MONGODB
      const netChange = won ? amount * (mult - 1) : -amount;

      userData.gold += netChange;
      await userData.save();

      // 6. LOG TO AUDIT
      await logToAudit(interaction.client, {
        userId,
        amount: netChange,
        reason: won
          ? `Slots Jackpot [${r1}${r2}${r3}]`
          : `Slots Loss [${r1}${r2}${r3}]`,
      }).catch((err) => console.error("Audit Log Error:", err));

      const resultEmbed = new EmbedBuilder()
        .setTitle(won ? "🎉 JACKPOT!" : "💀 BUSTED")
        .setColor(won ? 0x2ecc71 : 0xe74c3c)
        .setDescription(
          `## [ ${r1} | ${r2} | ${r3} ]\n` +
            `▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n` +
            `${won ? `Won **${(amount * mult).toLocaleString()}**` : `Lost **${amount.toLocaleString()}**`}\n\n` +
            `🏦 **New Balance:** \`${userData.gold.toLocaleString()}\` gold`,
        );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`slots_repeat_${amount}`)
          .setLabel(`Spin Again (${amount})`)
          .setStyle(ButtonStyle.Success)
          .setDisabled(userData.gold < amount), // Disable if they can't afford another spin
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
          // Use module.exports to ensure the context of the execute function is correct
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
