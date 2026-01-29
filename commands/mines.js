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

    // --- GAME STATE ---
    let revealed = 0;
    let isGameOver = false;
    const revealedIndices = [];
    const bombIndices = [];

    // Determine Cap based on your brackets
    let maxMultiplier = 2.0;
    if (mineCount > 10 && mineCount <= 15) maxMultiplier = 3.0;
    if (mineCount > 15) maxMultiplier = 4.0;

    // Calculate step: Each gem increases multiplier towards the cap
    // We'll give the full cap at 5 successful gems for a fast-paced feel
    const getMultiplier = (rev) => {
      if (rev === 0) return 1.0;
      const step = (maxMultiplier - 1) / 5;
      const current = 1 + step * rev;
      return Math.min(current, maxMultiplier);
    };

    const createGrid = (showLoss = false) => {
      const rows = [];
      for (let i = 0; i < 5; i++) {
        const row = new ActionRowBuilder();
        for (let j = 0; j < 5; j++) {
          const idx = i * 5 + j;

          // Cashout Button at bottom right
          if (idx === 24 && !isGameOver) {
            const mult = getMultiplier(revealed);
            const cashoutVal = Math.floor(amount * mult);
            row.addComponents(
              new ButtonBuilder()
                .setCustomId("mine_cashout")
                .setLabel(revealed > 0 ? `Cashout (${cashoutVal})` : "Cashout")
                .setStyle(ButtonStyle.Success)
                .setDisabled(revealed === 0),
            );
            continue;
          }

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
      return rows;
    };

    const baseEmbed = new EmbedBuilder()
      .setTitle("💣 OG MINES: FIXED ODDS")
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
                `### You cashed out **${winAmount}** gold!\nMultiplier: \`${finalMult.toFixed(2)}x\``,
              ),
          ],
          components: createGrid(true),
        });

        collector.stop();
        return;
      }

      const idx = parseInt(i.customId.split("_")[1]);

      // FIXED PROBABILITY LOGIC (45% chance to be a Gem)
      const roll = Math.random();
      const winChance = 0.45;

      if (roll > winChance) {
        // HIT A MINE
        isGameOver = true;
        bombIndices.push(idx);
        await safeUpdate(i, {
          embeds: [
            EmbedBuilder.from(baseEmbed)
              .setTitle("💥 BOOM")
              .setColor(0xe74c3c)
              .setDescription(`### Hit a mine!\nLost **${amount}** gold.`),
          ],
          components: createGrid(true),
        });
        collector.stop();
      } else {
        // HIT A GEM
        revealed++;
        revealedIndices.push(idx);
        const currentMult = getMultiplier(revealed);

        await safeUpdate(i, {
          embeds: [
            EmbedBuilder.from(baseEmbed).setDescription(
              `👤 **Player:** <@${userId}>\n💰 **Bet:** \`${amount}\` | 💣 **Mines:** \`${mineCount}\`\n✨ **Next Multiplier:** \`${currentMult.toFixed(2)}x\``,
            ),
          ],
          components: createGrid(),
        });
      }
    });

    collector.on("end", () => activeMines.delete(userId));
  },
};
