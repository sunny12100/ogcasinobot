const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const User = require("../models/User");
const { logToAudit } = require("../utils/logger");

// 🔒 Memory lock to prevent double-games
const activeMines = new Set();

module.exports = {
  name: "mines",
  async execute(interaction) {
    const amount = interaction.options.getInteger("amount");
    const mineCount = interaction.options.getInteger("mines") || 3;
    const userId = interaction.user.id;

    // 1. Prevent Double Play
    if (activeMines.has(userId)) {
      return interaction.reply({
        content:
          "❌ You already have a game in progress! If it crashed, wait 30s.",
        ephemeral: true,
      });
    }

    const userData = await User.findOne({ userId });
    if (!userData || userData.gold < amount) {
      return interaction.reply({
        content: "❌ Not enough gold!",
        ephemeral: true,
      });
    }

    // 2. Set Lock & Initial Deduction
    activeMines.add(userId);
    // Auto-reset lock after 30s as a fail-safe for errors
    const failSafe = setTimeout(() => activeMines.delete(userId), 30000);

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

    const getMultiplier = (rev) => {
      if (rev === 0) return 1.0;
      let mult = 1.0;
      for (let i = 0; i < rev; i++) {
        mult *= (25 - i) / (25 - i - mineCount);
      }
      const scalingFactor = rev <= 2 ? 0.82 : 0.94;
      return mult * scalingFactor;
    };

    const createGridRows = (revealedIndices = [], showMines = false) => {
      const rows = [];
      for (let i = 0; i < 5; i++) {
        const row = new ActionRowBuilder();
        for (let j = 0; j < 5; j++) {
          const index = i * 5 + j;
          if (index === 24 && !isGameOver) {
            const currentMult = getMultiplier(revealed);
            const cashoutVal = Math.floor(amount * currentMult);
            row.addComponents(
              new ButtonBuilder()
                .setCustomId("mine_cashout")
                .setLabel(
                  revealed > 0 ? `Cash Out (${cashoutVal})` : "Cash Out",
                )
                .setStyle(ButtonStyle.Success)
                .setDisabled(revealed === 0),
            );
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
      .setTitle("💣 PREMIER MINES")
      .setColor(0xffaa00)
      .setDescription(
        `👤 **Player:** <@${userId}>\n💰 **Bet:** \`${amount}\` | 💣 **Mines:** \`${mineCount}\`\n\n**Multiplier:** \`1.00x\``,
      );

    const msg = await interaction.reply({
      embeds: [mainEmbed],
      components: createGridRows(),
      fetchReply: true,
    });

    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 60000, // 1 minute per game
    });

    const revealedIndices = [];

    collector.on("collect", async (i) => {
      if (i.user.id !== userId)
        return i.reply({ content: "Not your game!", ephemeral: true });

      if (i.customId === "mine_cashout") {
        isGameOver = true;
        clearTimeout(failSafe);
        activeMines.delete(userId);
        collector.stop();

        const finalMult = getMultiplier(revealed);
        const winAmount = Math.floor(amount * finalMult);

        // Response first to avoid 10062
        await i.update({
          embeds: [
            EmbedBuilder.from(mainEmbed)
              .setTitle("💰 CASHOUT")
              .setColor(0x2ecc71)
              .setDescription(
                `### Payout: **${winAmount.toLocaleString()} gold**`,
              ),
          ],
          components: createGridRows(revealedIndices, true),
        });

        // Async DB update
        await User.updateOne({ userId }, { $inc: { gold: winAmount } });
        logToAudit(interaction.client, {
          userId,
          amount: winAmount - amount,
          reason: "Mines Cashout",
        }).catch(() => null);
        return;
      }

      const index = parseInt(i.customId.split("_")[1]);
      if (grid[index] === "mine") {
        isGameOver = true;
        clearTimeout(failSafe);
        activeMines.delete(userId);
        collector.stop();

        await i.update({
          embeds: [
            EmbedBuilder.from(mainEmbed)
              .setTitle("💥 BOOM!")
              .setColor(0xe74c3c)
              .setDescription(`### Hit a mine! Loss: \`${amount}\``),
          ],
          components: createGridRows(revealedIndices, true),
        });

        logToAudit(interaction.client, {
          userId,
          amount: -amount,
          reason: "Mines Hit",
        }).catch(() => null);
      } else {
        revealed++;
        revealedIndices.push(index);
        const currentMult = getMultiplier(revealed);

        await i.update({
          embeds: [
            EmbedBuilder.from(mainEmbed).setDescription(
              `👤 **Player:** <@${userId}>\n💰 **Bet:** \`${amount}\` | 💣 **Mines:** \`${mineCount}\`\n\n**Multiplier:** \`${currentMult.toFixed(2)}x\``,
            ),
          ],
          components: createGridRows(revealedIndices),
        });
      }
    });

    collector.on("end", () => {
      activeMines.delete(userId);
      clearTimeout(failSafe);
    });
  },
};
