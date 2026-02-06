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

// GLOBAL CLEANUP: Keeps memory clean if cards are abandoned
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
    // 1. DEFER IMMEDIATELY: Prevents "Interaction failed" errors from DB lag
    await interaction.deferReply();

    const { user, client, options } = interaction;
    const amount = options.getInteger("amount");

    // 2. ONE-BY-ONE LOCK: Prevents double-running
    if (activeScratch.has(user.id)) {
      return interaction.editReply(
        "❌ You already have an active card! Finish it first.",
      );
    }
    activeScratch.set(user.id, Date.now());

    let deductedUser;
    try {
      // ATOMIC TRANSACTION: Only deduct if they have enough gold
      deductedUser = await User.findOneAndUpdate(
        { userId: user.id, gold: { $gte: amount } },
        { $inc: { gold: -amount } },
        { new: true },
      );

      if (!deductedUser) {
        activeScratch.delete(user.id);
        return interaction.editReply(
          `❌ Insufficient gold! You need ${amount}.`,
        );
      }
    } catch (err) {
      console.error("Deduction Error:", err);
      activeScratch.delete(user.id);
      return interaction.editReply("❌ Database error. Please try again.");
    }

    /**
     * GRID GENERATOR
     * Handles the visual state of the 5x5 board
     */
    const getGrid = (revealedPos = null, emoji = null, finalReveals = []) => {
      const rows = [];
      for (let i = 0; i < 5; i++) {
        const row = new ActionRowBuilder();
        for (let j = 0; j < 5; j++) {
          const btnId = `scr_${i}_${j}`;
          const btn = new ButtonBuilder().setCustomId(btnId);
          const hiddenIcon = finalReveals.find((r) => r.pos === btnId);

          if (revealedPos === btnId) {
            // The tile the user actually clicked
            btn
              .setLabel(emoji)
              .setStyle(
                emoji === "❌" ? ButtonStyle.Danger : ButtonStyle.Success,
              )
              .setDisabled(true);
          } else if (hiddenIcon) {
            // The "missed" winners revealed at the end
            btn
              .setLabel(hiddenIcon.icon)
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(true);
          } else {
            // Standard unscratched tile
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
        `### Choose ONE tile to scratch!\n${"▬".repeat(22)}\n\` 🏆 Jackpot: 10x | 🎫 Winner: 2x | ❌ Loss: 0x \``,
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
        // PROBABILITY ENGINE
        const rng = Math.random() * 100;
        let mult = 0,
          emoji = "❌",
          status = "BETTER LUCK NEXT TIME",
          color = 0xe74c3c;

        if (rng < 2) {
          // 2% Jackpot
          mult = 10;
          emoji = "🏆";
          status = "💰 MEGA JACKPOT!";
          color = 0x2ecc71;
        } else if (rng < 32) {
          // 30% Winner
          mult = 2;
          emoji = "🎫";
          status = "✅ WINNER!";
          color = 0x5865f2;
        }

        const [r, c] = i.customId.split("_").slice(1).map(Number);

        // --- DYNAMIC REVEAL LOGIC ---
        const finalReveals = [];
        const allSpots = [];
        for (let ri = 0; ri < 5; ri++) {
          for (let ci = 0; ci < 5; ci++) {
            if (ri !== r || ci !== c) allSpots.push({ r: ri, c: ci });
          }
        }
        allSpots.sort(() => Math.random() - 0.5);

        // Always show the 10x Jackpot trophy if the player didn't win it
        if (mult < 10) {
          const p = allSpots.pop();
          finalReveals.push({ pos: `scr_${p.r}_${p.c}`, icon: "🏆" });
        }

        // Always ensure exactly 6 Ticket icons are visible on the board total
        const ticketsToReveal = mult === 2 ? 5 : 6;
        for (let k = 0; k < ticketsToReveal; k++) {
          if (allSpots.length > 0) {
            const p = allSpots.pop();
            finalReveals.push({ pos: `scr_${p.r}_${p.c}`, icon: "🎫" });
          }
        }

        const payout = amount * mult;
        const net = payout - amount;

        // DB SETTLEMENT
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
              value: `\`\`\`diff\n- Bet: ${amount}\n+ Payout: ${payout}\n${net >= 0 ? "+" : "-"} Profit: ${net}\n\`\`\``,
              inline: true,
            },
            {
              name: "💳 BALANCE",
              value: `**${finalUser.gold}** gold`,
              inline: true,
            },
          );

        // Update the existing message with results
        await i.update({
          embeds: [resultEmbed],
          components: getGrid(i.customId, emoji, finalReveals),
        });

        logToAudit(client, {
          userId: user.id,
          bet: amount,
          amount: net,
          oldBalance: deductedUser.gold,
          newBalance: finalUser.gold,
          reason: `Scratch: ${mult}x`,
        });
      } catch (err) {
        console.error("Game Error:", err);
        if (!settled) {
          // Emergency refund if crash happened before payout
          await User.updateOne({ userId: user.id }, { $inc: { gold: amount } });
          await interaction.followUp({
            content: "❌ Error occurred. Bet refunded.",
            ephemeral: true,
          });
        }
      } finally {
        activeScratch.delete(user.id);
      }
    });

    collector.on("end", async (collected, reason) => {
      if (reason === "time" && collected.size === 0) {
        activeScratch.delete(user.id);
        try {
          // AFK REFUND LOGIC
          await User.updateOne({ userId: user.id }, { $inc: { gold: amount } });

          const timeoutEmbed = new EmbedBuilder()
            .setTitle("⏱️ Card Expired")
            .setColor(0x34495e)
            .setDescription(
              `You went AFK. Your **${amount} gold** has been returned to your wallet.`,
            );

          await interaction.editReply({
            embeds: [timeoutEmbed],
            components: getGrid(null, null, []),
          });
        } catch (e) {
          console.error("AFK Refund Error:", e);
        }
      }
    });
  },
};
