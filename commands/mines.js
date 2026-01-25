const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const User = require("../models/User");
const { logToAudit } = require("../utils/logger");

module.exports = {
  name: "mines",
  async execute(interaction) {
    const amount = interaction.options.getInteger("amount");
    const mineCount = interaction.options.getInteger("mines") || 3;
    const userId = interaction.user.id;

    // 1. Database Check
    const userData = await User.findOne({ userId });
    if (!userData) {
      return interaction.reply({
        content:
          "❌ You are not registered! Please use the registration panel first.",
        ephemeral: true,
      });
    }

    if (userData.gold < amount) {
      return interaction.reply({
        content: `❌ Not enough gold! Balance: \`${userData.gold.toLocaleString()}\``,
        ephemeral: true,
      });
    }

    // 2. Initial Setup
    // Deduct bet immediately to prevent abuse
    userData.gold -= amount;
    await userData.save();

    let revealed = 0;
    let isGameOver = false;
    const grid = Array(25).fill("gem");
    const minePositions = [];

    while (minePositions.length < mineCount) {
      const r = Math.floor(Math.random() * 25);
      if (!minePositions.includes(r)) {
        minePositions.push(r);
        grid[r] = "mine";
      }
    }

    // Helper to calculate multiplier
    const getMultiplier = (rev) => {
      let mult = 1.0;
      for (let i = 0; i < rev; i++) {
        mult *= (25 - i) / (25 - i - mineCount);
      }
      return mult * 0.95; // 5% House Edge
    };

    // 3. UI Generator (Corrected: Integrates Cashout into the grid rows)
    const createGridRows = (revealedIndices = [], showMines = false) => {
      const rows = [];
      for (let i = 0; i < 5; i++) {
        const row = new ActionRowBuilder();
        for (let j = 0; j < 5; j++) {
          const index = i * 5 + j;

          // Replace the very last button (index 24) with a Cash Out button
          // This ensures we never exceed 5 rows total
          if (index === 24 && !isGameOver) {
            const currentMult = getMultiplier(revealed);
            const cashoutVal = Math.floor(amount * currentMult);
            const cashoutBtn = new ButtonBuilder()
              .setCustomId("mine_cashout")
              .setLabel(revealed > 0 ? `Cash Out (${cashoutVal})` : "Cash Out")
              .setStyle(ButtonStyle.Success)
              .setDisabled(revealed === 0);
            row.addComponents(cashoutBtn);
            continue;
          }

          const btn = new ButtonBuilder().setCustomId(`mine_${index}`);

          if (revealedIndices.includes(index)) {
            btn.setLabel("💎").setStyle(ButtonStyle.Primary).setDisabled(true);
          } else if (showMines && grid[index] === "mine") {
            btn.setLabel("💣").setStyle(ButtonStyle.Danger).setDisabled(true);
          } else {
            btn
              .setLabel("?")
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(isGameOver);
          }
          row.addComponents(btn);
        }
        rows.push(row);
      }
      return rows;
    };

    const mainEmbed = new EmbedBuilder()
      .setTitle("💣 OG MINES")
      .setColor(0xffaa00)
      .setDescription(
        `👤 **Player:** <@${userId}>\n💰 **Bet:** \`${amount.toLocaleString()}\` | 💣 **Mines:** \`${mineCount}\`\n\n**Multiplier:** \`1.00x\`\n**Profit:** \`0\` gold\n\n*Tap tiles to find gems. Bottom-right button is Cash Out!*`,
      );

    const msg = await interaction.reply({
      embeds: [mainEmbed],
      components: createGridRows(),
      fetchReply: true,
    });

    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 120000,
    });

    const revealedIndices = [];

    collector.on("collect", async (i) => {
      if (i.user.id !== userId)
        return i.reply({ content: "Not your game!", ephemeral: true });

      // --- CASHOUT LOGIC ---
      if (i.customId === "mine_cashout") {
        isGameOver = true;
        collector.stop();
        const finalMult = getMultiplier(revealed);
        const winAmount = Math.floor(amount * finalMult);

        userData.gold += winAmount;
        await userData.save();

        await logToAudit(interaction.client, {
          userId,
          amount: winAmount - amount,
          reason: `Mines Cashout (${mineCount} mines, ${revealed} gems)`,
        }).catch(() => null);

        const winEmbed = EmbedBuilder.from(mainEmbed)
          .setColor(0x2ecc71)
          .setTitle("💰 CASHED OUT")
          .setDescription(
            `### Payout: **${winAmount.toLocaleString()} gold**\nMultiplier: \`${finalMult.toFixed(2)}x\``,
          );

        return i.update({
          embeds: [winEmbed],
          components: createGridRows(revealedIndices, true),
        });
      }

      // --- MINE/GEM LOGIC ---
      const index = parseInt(i.customId.split("_")[1]);

      if (grid[index] === "mine") {
        isGameOver = true;
        collector.stop();

        await logToAudit(interaction.client, {
          userId,
          amount: -amount,
          reason: `Mines Hit (Lost ${amount})`,
        }).catch(() => null);

        const loseEmbed = EmbedBuilder.from(mainEmbed)
          .setColor(0xe74c3c)
          .setTitle("💥 BOOM!")
          .setDescription(
            `### You hit a mine!\nLost: \`${amount.toLocaleString()}\` gold`,
          );

        return i.update({
          embeds: [loseEmbed],
          components: createGridRows(revealedIndices, true),
        });
      } else {
        revealed++;
        revealedIndices.push(index);
        const currentMult = getMultiplier(revealed);
        const currentProfit = Math.floor(amount * currentMult) - amount;

        const updatedEmbed = EmbedBuilder.from(mainEmbed).setDescription(
          `👤 **Player:** <@${userId}>\n💰 **Bet:** \`${amount.toLocaleString()}\` | 💣 **Mines:** \`${mineCount}\`\n\n**Multiplier:** \`${currentMult.toFixed(2)}x\`\n**Profit:** \`+${currentProfit.toLocaleString()}\` gold`,
        );

        await i.update({
          embeds: [updatedEmbed],
          components: createGridRows(revealedIndices),
        });
      }
    });
  },
};
