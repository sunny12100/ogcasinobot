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

/* ---------------- SAFE INTERACTION HANDLER ---------------- */
const safeUpdate = async (interaction, payload) => {
  try {
    if (interaction.replied || interaction.deferred) return;
    await interaction.update(payload);
  } catch (err) {
    // Ignore expired / unknown interactions
    if (err.code !== 10062) {
      console.error("Interaction update error:", err);
    }
  }
};
/* ---------------------------------------------------------- */

module.exports = {
  name: "mines",
  async execute(interaction) {
    const amount = interaction.options.getInteger("amount");
    const mineCount = interaction.options.getInteger("mines") || 3;
    const userId = interaction.user.id;

    if (activeMines.has(userId)) {
      return interaction.reply({
        content: "❌ You already have a mines game running!",
        ephemeral: true,
      });
    }

    const user = await User.findOne({ userId });
    if (!user || user.gold < amount) {
      return interaction.reply({
        content: "❌ Not enough gold!",
        ephemeral: true,
      });
    }

    const initialBalance = user.gold;
    activeMines.add(userId);

    const failSafe = setTimeout(() => activeMines.delete(userId), 120000);

    await User.updateOne({ userId }, { $inc: { gold: -amount } });

    let revealed = 0;
    let isGameOver = false;
    const revealedIndices = [];

    /* ---------------- GRID SETUP ---------------- */
    const grid = Array(25).fill("gem");
    const mines = new Set();

    while (mines.size < mineCount) {
      mines.add(Math.floor(Math.random() * 25));
    }
    for (const i of mines) grid[i] = "mine";
    /* -------------------------------------------- */

    const getMultiplier = (rev) => {
      if (rev === 0) return 1;
      let prob = 1;
      for (let i = 0; i < rev; i++) {
        prob *= (25 - mineCount - i) / (25 - i);
      }
      return (1 / prob) * 0.92; // 8% house edge
    };

    const createGrid = (showMines = false) => {
      const rows = [];

      for (let i = 0; i < 5; i++) {
        const row = new ActionRowBuilder();

        for (let j = 0; j < 5; j++) {
          const idx = i * 5 + j;

          if (idx === 24 && !isGameOver) {
            const mult = getMultiplier(revealed);
            const cashout = Math.floor(amount * mult);

            row.addComponents(
              new ButtonBuilder()
                .setCustomId("mine_cashout")
                .setLabel(revealed > 0 ? `Cash Out (${cashout})` : "Cash Out")
                .setStyle(ButtonStyle.Success)
                .setDisabled(revealed === 0),
            );
            continue;
          }

          const btn = new ButtonBuilder().setCustomId(`mine_${idx}`);

          if (revealedIndices.includes(idx)) {
            btn.setLabel("💎").setStyle(ButtonStyle.Primary).setDisabled(true);
          } else if (showMines && grid[idx] === "mine") {
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

    const baseEmbed = new EmbedBuilder()
      .setTitle("💣 PREMIER MINES")
      .setColor(0xffaa00)
      .setDescription(
        `👤 **Player:** <@${userId}>\n💰 **Bet:** \`${amount}\` | 💣 **Mines:** \`${mineCount}\`\n\n**Multiplier:** \`1.00x\``,
      );

    const msg = await interaction.reply({
      embeds: [baseEmbed],
      components: createGrid(),
      fetchReply: true,
    });

    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 120000,
    });

    collector.on("collect", async (i) => {
      if (i.user.id !== userId)
        return i.reply({ content: "❌ Not your game!", ephemeral: true });

      if (isGameOver) return;

      /* ---------- CASHOUT ---------- */
      if (i.customId === "mine_cashout") {
        isGameOver = true;

        const mult = getMultiplier(revealed);
        const win = Math.floor(amount * mult);

        const updatedUser = await User.findOneAndUpdate(
          { userId },
          { $inc: { gold: win } },
          { new: true },
        );

        await safeUpdate(i, {
          embeds: [
            EmbedBuilder.from(baseEmbed)
              .setTitle("💰 CASHED OUT")
              .setColor(0x2ecc71)
              .setDescription(
                `### Won **${win} gold**\nMultiplier: \`${mult.toFixed(2)}x\``,
              ),
          ],
          components: createGrid(true),
        });

        collector.stop("cashout");

        await logToAudit(interaction.client, {
          userId,
          bet: amount,
          amount: win - amount,
          oldBalance: initialBalance,
          newBalance: updatedUser.gold,
          reason: `Mines Cashout (${revealed} gems)`,
        }).catch(() => null);

        return;
      }

      /* ---------- TILE CLICK ---------- */
      const idx = Number(i.customId.split("_")[1]);

      if (grid[idx] === "mine") {
        isGameOver = true;
        const lostUser = await User.findOne({ userId });

        await safeUpdate(i, {
          embeds: [
            EmbedBuilder.from(baseEmbed)
              .setTitle("💥 BOOM!")
              .setColor(0xe74c3c)
              .setDescription(`### You hit a mine!\nLost **${amount} gold**`),
          ],
          components: createGrid(true),
        });

        collector.stop("mine");

        await logToAudit(interaction.client, {
          userId,
          bet: amount,
          amount: -amount,
          oldBalance: initialBalance,
          newBalance: lostUser.gold,
          reason: "Mines Hit Mine",
        }).catch(() => null);

        return;
      }

      /* ---------- SAFE TILE ---------- */
      revealed++;
      revealedIndices.push(idx);
      const mult = getMultiplier(revealed);

      await safeUpdate(i, {
        embeds: [
          EmbedBuilder.from(baseEmbed).setDescription(
            `👤 **Player:** <@${userId}>\n💰 **Bet:** \`${amount}\` | 💣 **Mines:** \`${mineCount}\`\n\n**Multiplier:** \`${mult.toFixed(
              2,
            )}x\``,
          ),
        ],
        components: createGrid(),
      });
    });

    collector.on("end", async (_, reason) => {
      activeMines.delete(userId);
      clearTimeout(failSafe);

      if (!isGameOver && reason === "time") {
        try {
          await interaction.editReply({
            components: createGrid(true),
          });
        } catch {}
      }
    });
  },
};
