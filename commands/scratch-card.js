const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  SlashCommandBuilder,
} = require("discord.js");
const User = require("../models/User");
const { logToAudit } = require("../utils/logger");

const activeScratch = new Map();
const SESSION_EXPIRY = 45000;

// GLOBAL CLEANUP: Runs every 30s to keep execution fast
setInterval(() => {
  const now = Date.now();
  for (const [id, ts] of activeScratch) {
    if (now - ts > SESSION_EXPIRY) activeScratch.delete(id);
  }
}, 30000);

module.exports = {
  data: new SlashCommandBuilder()
    .setName("scratch")
    .setDescription("Buy a 5x5 scratch card and find the jackpot!")
    .addIntegerOption((opt) =>
      opt
        .setName("amount")
        .setDescription("Gold to bet (25-500)")
        .setRequired(true)
        .setMinValue(25)
        .setMaxValue(500),
    ),

  async execute(interaction) {
    const { user, client, options } = interaction;
    const amount = options.getInteger("amount");

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
      // Deduct cost immediately with a check for sufficient funds
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

    // GRID GENERATOR: Handles initial view and final reveal
    const getGrid = (revealedPos = null, emoji = null, nearMisses = []) => {
      const rows = [];
      for (let i = 0; i < 5; i++) {
        const row = new ActionRowBuilder();
        for (let j = 0; j < 5; j++) {
          const btnId = `scr_${i}_${j}`;
          const btn = new ButtonBuilder().setCustomId(btnId);

          const miss = nearMisses.find((m) => m.pos === btnId);

          if (revealedPos === btnId) {
            // The user's actual choice
            btn
              .setLabel(emoji)
              .setStyle(
                emoji === "❌" ? ButtonStyle.Danger : ButtonStyle.Success,
              )
              .setDisabled(true);
          } else if (miss) {
            // The "Tease" reveals
            btn
              .setLabel(miss.icon)
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(true);
          } else {
            // Unscratched tiles
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

      // 2. IMMEDIATE STOP: Prevents double-clicking gold exploits
      collector.stop("scratched");
      let settled = false;

      try {
        // 3. PROBABILITY ENGINE (80% RTP)
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

        // 4. COORDINATE PARSING
        const [r, c] = i.customId.split("_").slice(1).map(Number);

        // 5. ENHANCED VISUAL TEASE: Reveal where the winners "were"
        const nearMisses = [];
        const allOtherPositions = [];
        for (let rIdx = 0; rIdx < 5; rIdx++) {
          for (let cIdx = 0; cIdx < 5; cIdx++) {
            if (rIdx !== r || cIdx !== c)
              allOtherPositions.push({ r: rIdx, c: cIdx });
          }
        }
        allOtherPositions.sort(() => Math.random() - 0.5);

        // Show the 10x Jackpot they missed
        if (mult < 10) {
          const p = allOtherPositions.pop();
          nearMisses.push({ pos: `scr_${p.r}_${p.c}`, icon: "🏆" });
        }
        // Show NINE 2x Multipliers to make the card look "loaded"
        const teaseCount = 9;
        for (let j = 0; j < teaseCount; j++) {
          if (allOtherPositions.length > 0) {
            const p = allOtherPositions.pop();
            nearMisses.push({ pos: `scr_${p.r}_${p.c}`, icon: "🎫" });
          }
        }

        const payout = amount * mult;
        const net = payout - amount;

        // 6. SETTLEMENT: Money logic handled BEFORE UI update
        const finalUser = await User.findOneAndUpdate(
          { userId: user.id },
          { $inc: { gold: payout } },
          { new: true },
        );
        settled = true; // Mark as settled for idempotency

        // 7. UI UPDATE: Decoupled to prevent money errors on Discord lag
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
          console.error("UI Update Failed (Money was settled):", uiErr);
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
        // 8. EMERGENCY REFUND: Only if DB failed before payout
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
