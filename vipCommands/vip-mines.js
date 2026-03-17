const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  SlashCommandBuilder,
} = require("discord.js");
const PassUser = require("../models/PassUser");

const activeVipMines = new Set();
const GRID_SIZE = 20;
const VIP_RTP = 1.5; // 150% Return to Player

/* ---------------- MATH HELPERS ---------------- */
const comb = (n, k) => {
  if (k > n || k < 0) return 0;
  let res = 1;
  for (let i = 1; i <= k; i++) res = (res * (n - i + 1)) / i;
  return res;
};

const getVipMultiplier = (mines, revealed) => {
  if (revealed === 0) return 1.0;
  const safe = GRID_SIZE - mines;
  const fair = comb(GRID_SIZE, revealed) / comb(safe, revealed);

  // VIP Advantage Math
  let result = fair * VIP_RTP;

  // Scaling caps for high-risk plays
  const cap = mines > 10 ? 100.0 : 25.0;
  const progress = 1 - Math.exp(-0.35 * revealed);
  const softMax = 1 + (cap - 1) * progress;

  return Math.min(result, softMax).toFixed(2);
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("vip-mines")
    .setDescription("💎 VIP LOUNGE: High-Profit Mines (150% RTP)")
    .addIntegerOption((opt) =>
      opt
        .setName("amount")
        .setDescription("Gold to bet (1-5000)")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(5000),
    )
    .addIntegerOption((opt) =>
      opt
        .setName("mines")
        .setDescription("Number of mines (1-19)")
        .setMinValue(1)
        .setMaxValue(19),
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const amount = interaction.options.getInteger("amount");
    const mineCount = interaction.options.getInteger("mines") || 6;
    const LOUNGE_ROLE = "1483219208962834473";

    if (!interaction.member.roles.cache.has(LOUNGE_ROLE)) {
      return interaction.reply({
        content: "🚫 This game is exclusive to OG Pass holders!",
        ephemeral: true,
      });
    }

    if (activeVipMines.has(userId)) {
      return interaction.reply({
        content: "❌ Complete your current game first!",
        ephemeral: true,
      });
    }

    // Balance Check & Deduction
    let data = await PassUser.findOneAndUpdate(
      { userId, passBalance: { $gte: amount } },
      { $inc: { passBalance: -amount, totalLost: amount, gamesPlayed: 1 } },
      { new: true },
    );

    // Auto-Reload (Bust Protection)
    if (!data) {
      data = await PassUser.findOneAndUpdate(
        { userId },
        { $set: { passBalance: 50000 }, $inc: { gamesPlayed: 1 } },
        { upsert: true, new: true },
      );
      data = await PassUser.findOneAndUpdate(
        { userId },
        { $inc: { passBalance: -amount, totalLost: amount } },
        { new: true },
      );
    }

    activeVipMines.add(userId);
    let revealed = 0;
    let revealedIndices = [];
    const bombIndices = [];
    while (bombIndices.length < mineCount) {
      const r = Math.floor(Math.random() * GRID_SIZE);
      if (!bombIndices.includes(r)) bombIndices.push(r);
    }

    const createGrid = (showLoss = false) => {
      const rows = [];
      for (let i = 0; i < 4; i++) {
        const row = new ActionRowBuilder();
        for (let j = 0; j < 5; j++) {
          const idx = i * 5 + j;
          const btn = new ButtonBuilder().setCustomId(`vipmine_${idx}`);

          if (revealedIndices.includes(idx)) {
            btn.setEmoji("💎").setStyle(ButtonStyle.Primary).setDisabled(true);
          } else if (showLoss && bombIndices.includes(idx)) {
            btn.setEmoji("💣").setStyle(ButtonStyle.Danger).setDisabled(true);
          } else {
            btn
              .setLabel("?")
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(showLoss);
          }
          row.addComponents(btn);
        }
        rows.push(row);
      }
      const mult = getVipMultiplier(mineCount, revealed);
      rows.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("vip_cashout")
            .setLabel(
              revealed > 0
                ? `Cashout (${Math.floor(amount * mult).toLocaleString()} 💰)`
                : "Cashout",
            )
            .setStyle(ButtonStyle.Success)
            .setDisabled(revealed === 0 || showLoss),
        ),
      );
      return rows;
    };

    const baseEmbed = new EmbedBuilder()
      .setTitle("💎 VIP MINES")
      .setColor(0x00ffff)
      .setDescription(
        `💰 **Stake:** \`${amount.toLocaleString()}\` | 💣 **Mines:** \`${mineCount}\`\nPick a square to find diamonds!`,
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

      if (i.customId === "vip_cashout") {
        const mult = getVipMultiplier(mineCount, revealed);
        const winAmount = Math.floor(amount * mult);

        await PassUser.updateOne(
          { userId },
          { $inc: { passBalance: winAmount, totalWon: winAmount } },
        );

        await i.update({
          embeds: [
            new EmbedBuilder()
              .setTitle("💰 VIP CASHOUT SUCCESS")
              .setColor(0x2ecc71)
              .setDescription(
                `✨ **Multiplier:** \`${mult}x\`\n📈 **Payout:** \`${winAmount.toLocaleString()}\` gold`,
              ),
          ],
          components: createGrid(true),
        });
        return collector.stop("win");
      }

      const idx = parseInt(i.customId.split("_")[1]);
      if (bombIndices.includes(idx)) {
        await i.update({
          embeds: [
            new EmbedBuilder()
              .setTitle("💥 BOOM!")
              .setColor(0xe74c3c)
              .setDescription(
                `You hit a mine!\nLost **${amount.toLocaleString()}** gold.`,
              ),
          ],
          components: createGrid(true),
        });
        return collector.stop("loss");
      }

      revealed++;
      revealedIndices.push(idx);
      await i.update({
        embeds: [
          baseEmbed.setDescription(
            `💰 **Stake:** \`${amount.toLocaleString()}\` | 💣 **Mines:** \`${mineCount}\`\n✨ **Multiplier:** \`${getVipMultiplier(mineCount, revealed)}x\``,
          ),
        ],
        components: createGrid(),
      });
    });

    collector.on("end", (collected, reason) => {
      activeVipMines.delete(userId);
      if (reason === "time" && revealed === 0) {
        PassUser.updateOne(
          { userId },
          { $inc: { passBalance: amount, totalLost: -amount } },
        ).catch(() => null);
      }
    });
  },
};
