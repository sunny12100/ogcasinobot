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

    // --- INITIALIZATION & DEDUCTION ---
    activeMines.add(userId);
    const initialBalance = userData.gold;
    await User.updateOne({ userId }, { $inc: { gold: -amount } });

    let revealed = 0;
    let isGameOver = false;
    let gameStarted = false; // Flag for AFK Refund logic
    const revealedIndices = [];
    const bombIndices = [];

    // --- YOUR CUSTOM RIGGING TABLE ---
    // Click 1: 50% | Click 2: 70% | Click 3: 60% | Click 4: 40% | 5+: Extreme Risk
    const winChances = [0.5, 0.7, 0.6, 0.4, 0.1, 0.05];

    const getMultiplier = (rev) => {
      if (rev === 0) return 1.0;
      const base = 1.25; // Slightly boosted base for temptation
      return parseFloat(Math.pow(base, rev) + rev * 0.2).toFixed(2);
    };

    const createGrid = (showLoss = false) => {
      const rows = [];
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

      const mult = getMultiplier(revealed);
      const cashoutVal = Math.floor(amount * mult);

      const controlRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("mine_cashout")
          .setLabel(revealed > 0 ? `Cashout (${cashoutVal} 💰)` : "Cashout")
          .setStyle(ButtonStyle.Success)
          .setDisabled(revealed === 0 || isGameOver),
      );
      rows.push(controlRow);
      return rows;
    };

    const baseEmbed = new EmbedBuilder()
      .setTitle("💣 MINES")
      .setColor(0xffaa00)
      .setDescription(
        `💰 **Bet:** \`${amount}\` | 💣 **Mines:** \`${mineCount}\`\nPick a square to start!`,
      );

    const msg = await interaction.reply({
      embeds: [baseEmbed],
      components: createGrid(),
      fetchReply: true,
    });

    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 60000, // 1 minute to play
    });

    collector.on("collect", async (i) => {
      if (i.user.id !== userId)
        return i.reply({ content: "❌ Not your game!", ephemeral: true });

      gameStarted = true; // User interacted, disable AFK refund

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
              .setTitle("💰 CASHOUT SUCCESS")
              .setColor(0x2ecc71)
              .setDescription(
                `### Profit: **+${winAmount - amount}**\nFinal Multiplier: \`${finalMult}x\``,
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
          reason: `Mines Cashout (${revealed} gems)`,
        }).catch(() => null);

        collector.stop("cashed_out");
        return;
      }

      // --- TILE CLICK LOGIC ---
      const idx = parseInt(i.customId.split("_")[1]);
      const currentWinChance = winChances[revealed] || 0.05;

      if (Math.random() > currentWinChance) {
        // --- RIGGED LOSS ---
        isGameOver = true;
        bombIndices.push(idx);

        // Ghost Reveal: Fake the rest of the bomb positions
        while (bombIndices.length < mineCount) {
          let randomIdx = Math.floor(Math.random() * 20);
          if (
            !bombIndices.includes(randomIdx) &&
            !revealedIndices.includes(randomIdx)
          ) {
            bombIndices.push(randomIdx);
          }
        }

        const lostUser = await User.findOne({ userId });
        await safeUpdate(i, {
          embeds: [
            EmbedBuilder.from(baseEmbed)
              .setTitle("💥 BOOM!")
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

        collector.stop("hit_bomb");
      } else {
        // --- RIGGED WIN ---
        revealed++;
        revealedIndices.push(idx);
        await safeUpdate(i, {
          embeds: [
            EmbedBuilder.from(baseEmbed).setDescription(
              `💰 **Bet:** \`${amount}\` | 💣 **Mines:** \`${mineCount}\`\n✨ **Current Mult:** \`${getMultiplier(revealed)}x\``,
            ),
          ],
          components: createGrid(),
        });
      }
    });

    collector.on("end", async (collected, reason) => {
      activeMines.delete(userId);

      // --- AFK REFUND LOGIC ---
      if (reason === "time" && !gameStarted) {
        await User.updateOne({ userId }, { $inc: { gold: amount } });
        await interaction
          .editReply({
            embeds: [
              new EmbedBuilder()
                .setTitle("⏲️ TIMED OUT")
                .setColor(0x95a5a6)
                .setDescription(
                  `Game expired. Your bet of **${amount}** has been refunded.`,
                ),
            ],
            components: [], // Clear grid
          })
          .catch(() => null);
      } else if (reason === "time" && !isGameOver) {
        // If they played but didn't cash out and time ran out, we treat it as a loss (No refund)
        await interaction
          .editReply({ components: createGrid(true) })
          .catch(() => null);
      }
    });
  },
};
