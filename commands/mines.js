const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const User = require("../models/User");
const { logToAudit } = require("../utils/logger");

const activeMines = new Set();

const safeUpdate = async (interaction, payload) => {
  try {
    if (interaction.replied || interaction.deferred) return;
    await interaction.update(payload);
  } catch (err) {
    if (err.code !== 10062) console.error("Interaction update error:", err);
  }
};

module.exports = {
  name: "mines",
  async execute(interaction) {
    const amount = interaction.options.getInteger("amount");
    const mineCount = interaction.options.getInteger("mines") || 3;
    const userId = interaction.user.id;

    if (activeMines.has(userId)) {
      return interaction.reply({
        content: "❌ You already have a game running!",
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

    activeMines.add(userId);
    const initialBalance = userData.gold;
    await User.updateOne({ userId }, { $inc: { gold: -amount } });

    let revealed = 0;
    let isGameOver = false;
    const revealedIndices = [];
    const bombIndices = [];

    // --- BRACKET LOGIC ---
    let maxMultiplier = 2.0;
    if (mineCount > 10 && mineCount <= 15) maxMultiplier = 3.0;
    if (mineCount > 15) maxMultiplier = 4.0;

    // --- DYNAMIC MULTIPLIER (No Stagnation) ---
    // Total playable tiles in this version is 20 (4 rows of 5)
    const totalTiles = 20;
    const getMultiplier = (rev) => {
      if (rev === 0) return 1.0;

      // Using a power curve so it grows faster at the start but
      // keeps moving toward the max without stopping abruptly.
      // Formula: 1 + (Max - 1) * (current / total)^0.7
      const progress = rev / totalTiles;
      const currentMult = 1 + (maxMultiplier - 1) * Math.pow(progress, 0.7);

      return Math.min(currentMult, maxMultiplier);
    };

    const createGrid = (showLoss = false) => {
      const rows = [];
      // 4 Rows of Gems (20 Tiles)
      for (let i = 0; i < 4; i++) {
        const row = new ActionRowBuilder();
        for (let j = 0; j < 5; j++) {
          const idx = i * 5 + j;
          const btn = new ButtonBuilder().setCustomId(`mine_${idx}`);

          if (revealedIndices.includes(idx)) {
            btn.setEmoji("💎").setStyle(ButtonStyle.Primary).setDisabled(true);
          } else if (showLoss && bombIndices.includes(idx)) {
            btn.setEmoji("💣").setStyle(ButtonStyle.Danger).setDisabled(true);
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

      // 5th Row for Cashout
      const controlRow = new ActionRowBuilder();
      const mult = getMultiplier(revealed);
      const cashoutVal = Math.floor(amount * mult);

      controlRow.addComponents(
        new ButtonBuilder()
          .setCustomId("mine_cashout")
          .setLabel(revealed > 0 ? `Cashout (${cashoutVal})` : "Cashout")
          .setStyle(ButtonStyle.Success)
          .setDisabled(revealed === 0 || isGameOver),
      );
      rows.push(controlRow);

      return rows;
    };

    const baseEmbed = new EmbedBuilder()
      .setTitle("💣 OG MINES")
      .setColor(0xffaa00)
      .setDescription(
        `👤 **Player:** <@${userId}>\n💰 **Bet:** \`${amount}\` | 💣 **Mines:** \`${mineCount}\`\n📈 **Bracket Max:** \`${maxMultiplier}x\``,
      );

    const msg = await interaction.reply({
      embeds: [baseEmbed],
      components: createGrid(),
      fetchReply: true,
    });

    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 60000,
    });

    collector.on("collect", async (i) => {
      if (i.user.id !== userId)
        return i.reply({ content: "❌ Not your game!", ephemeral: true });

      if (i.customId === "mine_cashout") {
        isGameOver = true;
        const finalMult = getMultiplier(revealed);
        const winAmount = Math.floor(amount * finalMult);
        const winner = await User.findOneAndUpdate(
          { userId },
          { $inc: { gold: winAmount } },
          { new: true },
        );

        await safeUpdate(i, {
          embeds: [
            EmbedBuilder.from(baseEmbed)
              .setTitle("💰 WINNER")
              .setColor(0x2ecc71)
              .setDescription(
                `### Won **${winAmount}** gold!\nFinal Multiplier: \`${finalMult.toFixed(2)}x\``,
              ),
          ],
          components: createGrid(true),
        });

        logToAudit(interaction.client, {
          userId,
          bet: amount,
          amount: winAmount - amount,
          oldBalance: initialBalance,
          newBalance: winner.gold,
          reason: `Mines Win (${revealed} gems)`,
        }).catch(() => null);

        collector.stop();
        return;
      }

      const idx = parseInt(i.customId.split("_")[1]);

      // 45% Win Probability
      if (Math.random() > 0.45) {
        isGameOver = true;
        bombIndices.push(idx);
        const lostUser = await User.findOne({ userId });
        await safeUpdate(i, {
          embeds: [
            EmbedBuilder.from(baseEmbed)
              .setTitle("💥 BOOM")
              .setColor(0xe74c3c)
              .setDescription(`### Hit a mine!\nLost **${amount}** gold.`),
          ],
          components: createGrid(true),
        });

        logToAudit(interaction.client, {
          userId,
          bet: amount,
          amount: -amount,
          oldBalance: initialBalance,
          newBalance: lostUser.gold,
          reason: "Mines Loss",
        }).catch(() => null);

        collector.stop();
      } else {
        revealed++;
        revealedIndices.push(idx);
        await safeUpdate(i, {
          embeds: [
            EmbedBuilder.from(baseEmbed).setDescription(
              `👤 **Player:** <@${userId}>\n💰 **Bet:** \`${amount}\` | 💣 **Mines:** \`${mineCount}\`\n✨ **Multiplier:** \`${getMultiplier(revealed).toFixed(2)}x\``,
            ),
          ],
          components: createGrid(),
        });
      }
    });

    collector.on("end", () => activeMines.delete(userId));
  },
};
