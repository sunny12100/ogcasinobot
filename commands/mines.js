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

const GRID_SIZE = 20;
const HOUSE_EDGE = 0.06;

/* ---------------- EARLY GAME DAMPING ---------------- */
const EARLY_DAMPING = (k) => {
  if (k === 1) return 0.15;
  if (k === 2) return 0.35;
  if (k === 3) return 0.75;
  return 1;
};

/* ---------------- COMBINATORICS ---------------- */
const comb = (n, k) => {
  if (k > n || k < 0) return 0;
  let res = 1;
  for (let i = 1; i <= k; i++) {
    res = (res * (n - i + 1)) / i;
  }
  return res;
};

/* ---------------- FAIR MULTIPLIER ---------------- */
const fairMultiplier = (mines, revealed) => {
  const safe = GRID_SIZE - mines;
  return comb(GRID_SIZE, revealed) / comb(safe, revealed);
};

/* ---------------- MAX MULT BY MINE COUNT ---------------- */
const getMaxMultiplier = (mines) => {
  if (mines <= 5) return 2.0;
  if (mines <= 10) return 2.0;
  if (mines <= 16) return 2.5;
  return 3.0;
};

/* ---------------- LOGARITHMIC SOFT CAP ---------------- */
const applyLogCap = (raw, cap, revealed) => {
  const GROWTH_RATE = 0.55; // lower = slower approach

  const progress = 1 - Math.exp(-GROWTH_RATE * revealed);
  const softMax = 1 + (cap - 1) * progress;

  return Math.min(raw, softMax);
};

module.exports = {
  name: "mines",
  async execute(interaction) {
    const amount = interaction.options.getInteger("amount");
    const mineCount = interaction.options.getInteger("mines") || 6;
    const userId = interaction.user.id;

    if (mineCount < 1 || mineCount > 19) {
      return interaction.reply({
        content: "❌ Mines must be between 1 and 19.",
        ephemeral: true,
      });
    }

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
    let gameStarted = false;
    const revealedIndices = [];

    /* ---------------- REAL MINE PLACEMENT ---------------- */
    const bombIndices = [];
    while (bombIndices.length < mineCount) {
      const r = Math.floor(Math.random() * GRID_SIZE);
      if (!bombIndices.includes(r)) bombIndices.push(r);
    }

    /* ---------------- MULTIPLIER LOGIC ---------------- */
    const getMultiplier = () => {
      if (revealed === 0) return 1.0;

      const fair = fairMultiplier(mineCount, revealed);

      let raw = fair * (1 - HOUSE_EDGE) * EARLY_DAMPING(revealed);

      const cap = getMaxMultiplier(mineCount);
      raw = applyLogCap(raw, cap, revealed);

      return Math.max(raw, 1.01).toFixed(2);
    };

    /* ---------------- GRID UI ---------------- */
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

      const cashoutVal = Math.floor(amount * getMultiplier());

      rows.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("mine_cashout")
            .setLabel(revealed > 0 ? `Cashout (${cashoutVal} 💰)` : "Cashout")
            .setStyle(ButtonStyle.Success)
            .setDisabled(revealed === 0 || isGameOver),
        ),
      );

      return rows;
    };

    const baseEmbed = new EmbedBuilder()
      .setTitle("💣 MINES")
      .setColor(0xffaa00)
      .setDescription(
        `💰 **Bet:** \`${amount}\` | 💣 **Mines:** \`${mineCount}\`\nPick a square!`,
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

      gameStarted = true;

      if (i.customId === "mine_cashout") {
        isGameOver = true;

        const mult = getMultiplier();
        const winAmount = Math.floor(amount * mult);

        const winner = await User.findOneAndUpdate(
          { userId },
          { $inc: { gold: winAmount } },
          { new: true },
        );

        await i.update({
          embeds: [
            EmbedBuilder.from(baseEmbed)
              .setTitle("💰 CASHOUT")
              .setColor(0x2ecc71)
              .setDescription(
                `Final Multiplier: \`${mult}x\`\nProfit: **+${winAmount - amount}**`,
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
          reason: "Mines Cashout",
        }).catch(() => null);

        collector.stop("cashout");
        return;
      }

      const idx = parseInt(i.customId.split("_")[1]);
      if (revealedIndices.includes(idx)) return;

      if (bombIndices.includes(idx)) {
        isGameOver = true;

        await i.update({
          embeds: [
            EmbedBuilder.from(baseEmbed)
              .setTitle("💥 BOOM!")
              .setColor(0xe74c3c)
              .setDescription(`You hit a mine.\nLost **${amount}** gold.`),
          ],
          components: createGrid(true),
        });

        logToAudit(interaction.client, {
          userId,
          bet: amount,
          amount: -amount,
          oldBalance: initialBalance,
          newBalance: initialBalance - amount,
          reason: "Mines Loss",
        }).catch(() => null);

        collector.stop("loss");
        return;
      }

      revealed++;
      revealedIndices.push(idx);

      await i.update({
        embeds: [
          EmbedBuilder.from(baseEmbed).setDescription(
            `💰 **Bet:** \`${amount}\` | 💣 **Mines:** \`${mineCount}\`\n✨ **Multiplier:** \`${getMultiplier()}x\``,
          ),
        ],
        components: createGrid(),
      });
    });

    collector.on("end", async (_, reason) => {
      activeMines.delete(userId);

      if (reason === "time" && !gameStarted) {
        await User.updateOne({ userId }, { $inc: { gold: amount } });
        await interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("⏲️ TIMED OUT")
              .setColor(0x95a5a6)
              .setDescription(`Bet refunded.`),
          ],
          components: [],
        });
      }
    });
  },
};
