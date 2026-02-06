const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const User = require("../models/User");
const { logToAudit } = require("../utils/logger");

const activeScratch = new Map();
const SESSION_EXPIRY = 45000;
const COST = 100;

// GLOBAL CLEANUP: Runs every 30s instead of every command to keep execution O(1)
setInterval(() => {
  const now = Date.now();
  for (const [id, ts] of activeScratch) {
    if (now - ts > SESSION_EXPIRY) activeScratch.delete(id);
  }
}, 30000);

module.exports = {
  name: "scratch",
  async execute(interaction) {
    const { user, client } = interaction;

    // 1. ATOMIC LOCK
    if (activeScratch.has(user.id)) {
      return interaction.reply({
        content: "❌ Finish your current card first!",
        ephemeral: true,
      });
    }
    activeScratch.set(user.id, Date.now());

    await interaction.deferReply();

    let deductedUser;
    try {
      deductedUser = await User.findOneAndUpdate(
        { userId: user.id, gold: { $gte: COST } },
        { $inc: { gold: -COST } },
        { new: true },
      );

      if (!deductedUser) {
        activeScratch.delete(user.id);
        return interaction.editReply("❌ You don't have enough gold!");
      }
    } catch (err) {
      console.error("Deduction Error:", err);
      activeScratch.delete(user.id);
      return interaction.editReply("❌ Database error. Try again.");
    }

    const getGrid = (revealedPos = null, emoji = null, nearMissPos = null) => {
      const rows = [];
      for (let i = 0; i < 5; i++) {
        const row = new ActionRowBuilder();
        for (let j = 0; j < 5; j++) {
          const btnId = `scr_${i}_${j}`;
          const btn = new ButtonBuilder().setCustomId(btnId);
          if (revealedPos === btnId) {
            btn
              .setLabel(emoji)
              .setStyle(
                emoji === "❌" ? ButtonStyle.Danger : ButtonStyle.Success,
              )
              .setDisabled(true);
          } else if (nearMissPos === btnId) {
            btn
              .setLabel("🏆")
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(true);
          } else {
            btn
              .setLabel("?")
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(revealedPos !== null);
          }
          row.addComponents(btn);
        }
        rows.push(row);
      }
      return rows;
    };

    const embed = new EmbedBuilder()
      .setTitle("🎫 Super 25 Scratch-Off")
      .setColor(0xf1c40f)
      .setDescription(
        `### Choose ONE tile to scratch!\n${"▬".repeat(22)}\n\` 🏆 Jackpot: 10x  |  🎫 Winner: 2x  |  ❌ Dud: 0x \``,
      )
      .addFields({
        name: "💳 WALLET",
        value: `**${deductedUser.gold}** gold`,
        inline: true,
      })
      .setFooter({ text: `80% RTP | Cost: ${COST}` });

    const msg = await interaction.editReply({
      embeds: [embed],
      components: getGrid(),
    });

    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: SESSION_EXPIRY,
    });

    collector.on("collect", async (i) => {
      if (i.user.id !== user.id)
        return i.reply({ content: "Not your card!", ephemeral: true });

      collector.stop("scratched");
      let settled = false; // Transaction guard flag

      try {
        // MATH ENGINE
        const rng = Math.random() * 100;
        let mult = 0,
          emoji = "❌",
          status = "BETTER LUCK NEXT TIME",
          color = 0xe74c3c;
        if (rng < 2) {
          mult = 10;
          emoji = "🏆";
          status = "💰 MEGA JACKPOT!";
          color = 0x2ecc71;
        } else if (rng < 32) {
          mult = 2;
          emoji = "🎫";
          status = "✅ WINNER!";
          color = 0x5865f2;
        }

        const [r, c] = i.customId.split("_").slice(1).map(Number);
        let nearMissPos = null;
        if (mult < 10) {
          const offsets = [
            [0, 1],
            [0, -1],
            [1, 0],
            [-1, 0],
            [1, 1],
            [1, -1],
            [-1, 1],
            [-1, -1],
          ];
          const validOffsets = offsets.filter(
            ([dr, dc]) =>
              r + dr >= 0 && r + dr < 5 && c + dc >= 0 && c + dc < 5,
          );
          if (validOffsets.length > 0) {
            const [dr, dc] =
              validOffsets[Math.floor(Math.random() * validOffsets.length)];
            nearMissPos = `scr_${r + dr}_${c + dc}`;
          }
        }

        const payout = COST * mult;
        const net = payout - COST;

        // MONEY LOGIC: Settlement
        const finalUser = await User.findOneAndUpdate(
          { userId: user.id },
          { $inc: { gold: payout } },
          { new: true },
        );
        settled = true; // Mark transaction as successful

        // UI LOGIC: Decoupled from Settlement
        const resultEmbed = new EmbedBuilder()
          .setTitle(`🎫 Result: ${status}`)
          .setColor(color)
          .addFields(
            {
              name: "💰 SETTLEMENT",
              value: `\`\`\`diff\n- Cost:   ${COST}\n+ Payout: ${payout}\n${net >= 0 ? "+" : "-"} Profit: ${net}\n\`\`\``,
              inline: true,
            },
            {
              name: "💳 NEW BALANCE",
              value: `**${finalUser.gold}** gold`,
              inline: true,
            },
          );

        try {
          await i.update({
            embeds: [resultEmbed],
            components: getGrid(i.customId, emoji, nearMissPos),
          });
        } catch (uiErr) {
          console.error("UI Update Failed (but money was settled):", uiErr);
        }

        logToAudit(client, {
          userId: user.id,
          bet: COST,
          amount: net,
          oldBalance: deductedUser.gold,
          newBalance: finalUser.gold,
          reason: `Scratch: ${mult}x`,
        });
      } catch (err) {
        console.error("Scratch Processing Error:", err);

        // Only refund if the DB update never finished
        if (!settled) {
          await User.updateOne({ userId: user.id }, { $inc: { gold: COST } });
          const errContent = "❌ Card failed. Your bet has been refunded.";
          if (i.deferred || i.replied)
            await i.followUp({ content: errContent, ephemeral: true });
          else await i.reply({ content: errContent, ephemeral: true });
        }
      } finally {
        activeScratch.delete(user.id);
      }
    });

    collector.on("end", async (collected, reason) => {
      if (reason === "time" && collected.size === 0) {
        activeScratch.delete(user.id);
        try {
          const timeoutEmbed = new EmbedBuilder()
            .setTitle("⏱️ Card Expired")
            .setColor(0x34495e)
            .setDescription(
              `The card was voided because you didn't scratch in time.\n**Cost: ${COST} gold**`,
            );
          await interaction.editReply({
            embeds: [timeoutEmbed],
            components: getGrid(null, null, null),
          });
        } catch {}
      }
    });
  },
};
