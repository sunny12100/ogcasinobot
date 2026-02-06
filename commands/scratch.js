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

// GLOBAL CLEANUP: Runs every 30s
setInterval(() => {
  const now = Date.now();
  for (const [id, ts] of activeScratch) {
    if (now - ts > SESSION_EXPIRY) activeScratch.delete(id);
  }
}, 30000);

module.exports = {
  name: "scratch",
  async execute(interaction) {
    const { user, client, options } = interaction;
    const amount = options.getInteger("amount"); // Dynamic bet amount

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
        { userId: user.id, gold: { $gte: amount } },
        { $inc: { gold: -amount } },
        { new: true },
      );

      if (!deductedUser) {
        activeScratch.delete(user.id);
        return interaction.editReply(
          `❌ You don't have enough gold! (Need ${amount})`,
        );
      }
    } catch (err) {
      console.error("Deduction Error:", err);
      activeScratch.delete(user.id);
      return interaction.editReply("❌ Database error. Try again.");
    }

    const getGrid = (revealedPos = null, emoji = null, nearMisses = []) => {
      const rows = [];
      for (let i = 0; i < 5; i++) {
        const row = new ActionRowBuilder();
        for (let j = 0; j < 5; j++) {
          const btnId = `scr_${i}_${j}`;
          const btn = new ButtonBuilder().setCustomId(btnId);

          const miss = nearMisses.find((m) => m.pos === btnId);

          if (revealedPos === btnId) {
            btn
              .setLabel(emoji)
              .setStyle(
                emoji === "❌" ? ButtonStyle.Danger : ButtonStyle.Success,
              )
              .setDisabled(true);
          } else if (miss) {
            btn
              .setLabel(miss.icon)
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
        `### Choose ONE tile to scratch!\n${"▬".repeat(22)}\n\` 🏆 Jackpot: 10x  |  🎫 Winner: 2x  |  ❌ Loss: 0x \``,
      )
      .addFields({
        name: "💳 WALLET",
        value: `**${deductedUser.gold}** gold`,
        inline: true,
      })
      .setFooter({ text: `Card Value: ${amount} Gold` });

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
      let settled = false;

      try {
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

        // --- MULTI-NEAR-MISS LOGIC ---
        const nearMisses = [];
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
        const validOffsets = offsets
          .map(([dr, dc]) => ({ r: r + dr, c: c + dc }))
          .filter((pos) => pos.r >= 0 && pos.r < 5 && pos.c >= 0 && pos.c < 5)
          .sort(() => Math.random() - 0.5); // Shuffle offsets

        // Add 10x Tease (if not won)
        if (mult < 10 && validOffsets.length > 0) {
          const p = validOffsets.pop();
          nearMisses.push({ pos: `scr_${p.r}_${p.c}`, icon: "🏆" });
        }
        // Add 2x Tease (if lost)
        if (mult < 2 && validOffsets.length > 0) {
          const p = validOffsets.pop();
          nearMisses.push({ pos: `scr_${p.r}_${p.c}`, icon: "🎫" });
        }

        const payout = amount * mult;
        const net = payout - amount;

        // SETTLEMENT
        const finalUser = await User.findOneAndUpdate(
          { userId: user.id },
          { $inc: { gold: payout } },
          { new: true },
        );
        settled = true;

        const resultEmbed = new EmbedBuilder()
          .setTitle(`🎫 Result: ${status}`)
          .setColor(color)
          .addFields(
            {
              name: "💰 SETTLEMENT",
              value: `\`\`\`diff\n- Bet:    ${amount}\n+ Payout: ${payout}\n${net >= 0 ? "+" : "-"} Profit: ${net}\n\`\`\``,
              inline: true,
            },
            {
              name: "💳 BALANCE",
              value: `**${finalUser.gold}** gold`,
              inline: true,
            },
          );

        try {
          await i.update({
            embeds: [resultEmbed],
            components: getGrid(i.customId, emoji, nearMisses),
          });
        } catch (uiErr) {
          console.error("UI Update Failed:", uiErr);
        }

        logToAudit(client, {
          userId: user.id,
          bet: amount,
          amount: net,
          oldBalance: deductedUser.gold,
          newBalance: finalUser.gold,
          reason: `Scratch: ${mult}x`,
        });
      } catch (err) {
        console.error("Scratch Processing Error:", err);
        if (!settled) {
          await User.updateOne({ userId: user.id }, { $inc: { gold: amount } });
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
              `You didn't scratch in time. The card has been voided.\n**Loss: ${amount} gold**`,
            );
          await interaction.editReply({
            embeds: [timeoutEmbed],
            components: getGrid(null, null, []),
          });
        } catch {}
      }
    });
  },
};
