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
  name: "slots",
  async execute(interaction, repeatAmount = null) {
    // 1. Determine bet amount (either from slash command or repeat button)
    const amount = repeatAmount ?? interaction.options.getInteger("amount");
    const userId = interaction.user.id;

    // 2. STRICT VERIFICATION CHECK
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

    // 3. STARTING THE GAME
    const spinGif =
      "https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExd2l6MzhjMGF0cW12aW9nOTlrdG1odnhjOHY0NnVna3VraHBmdGZsZCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/Ce18KspdcaxaKuZ1HC/giphy.gif";

    const spinningEmbed = new EmbedBuilder()
      .setTitle("🎰 SPINNING...")
      .setColor(0xffaa00)
      .setImage(spinGif)
      .setDescription(`Betting **${amount.toLocaleString()}** gold!`);

    // Handle initial reply vs button update
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

    // 4. THE CALCULATION (Wrapped in timeout for effect)
    setTimeout(async () => {
      const symbols = ["🍒", "🍋", "🍇", "🔔", "💎", "7️⃣"];
      const winProbability = 0.42;
      const isLucky = Math.random() < winProbability;

      let r1, r2, r3;
      if (isLucky) {
        r1 = r2 = r3 = symbols[Math.floor(Math.random() * symbols.length)];
      } else {
        r1 = symbols[Math.floor(Math.random() * symbols.length)];
        r2 = symbols[Math.floor(Math.random() * symbols.length)];
        r3 = symbols[Math.floor(Math.random() * symbols.length)];
        if (r1 === r2 && r2 === r3)
          r3 = symbols[(symbols.indexOf(r3) + 1) % symbols.length];
      }

      const won = r1 === r2 && r2 === r3;
      const mult = won ? (r1 === "7️⃣" ? 10 : r1 === "💎" ? 5 : 3) : 0;

      const freshUsers = loadUsers();
      const netChange = won ? amount * (mult - 1) : -amount;
      freshUsers[userId].balance += netChange;
      saveUsers(freshUsers);

      await logToAudit(interaction.client, {
        userId,
        amount: netChange,
        reason: won
          ? `Slots Jackpot [${r1}${r2}${r3}]`
          : `Slots Loss [${r1}${r2}${r3}]`,
      });

      const resultEmbed = new EmbedBuilder()
        .setTitle(won ? "🎉 JACKPOT!" : "💀 BUSTED")
        .setColor(won ? 0x2ecc71 : 0xe74c3c)
        .setDescription(
          `## [ ${r1} | ${r2} | ${r3} ]\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n${won ? `Won **${(amount * mult).toLocaleString()}**` : `Lost **${amount.toLocaleString()}**`}\n\n🏦 **Balance:** \`${freshUsers[userId].balance.toLocaleString()}\``,
        );

      // 5. THE BUTTONS (The "Next Step" logic)
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`slots_repeat_${amount}`)
          .setLabel(`Spin Again (${amount})`)
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId("slots_end")
          .setLabel("Quit")
          .setStyle(ButtonStyle.Danger),
      );

      await interaction.editReply({ embeds: [resultEmbed], components: [row] });

      // 6. COLLECTOR FOR BUTTONS
      const collector = response.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 15000, // 15 seconds to re-bet
      });

      collector.on("collect", async (i) => {
        if (i.user.id !== interaction.user.id)
          return i.reply({ content: "Start your own game!", ephemeral: true });

        if (i.customId.startsWith("slots_repeat_")) {
          await i.deferUpdate();
          collector.stop();
          // Recursive call to start again
          return this.execute(i, amount);
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
