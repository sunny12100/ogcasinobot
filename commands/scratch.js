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

// Cleanup expired sessions
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
        .setDescription("Gold to bet (25–500)")
        .setRequired(true)
        .setMinValue(25)
        .setMaxValue(500),
    ),

  async execute(interaction) {
    let replied = false;

    try {
      await interaction.deferReply();
      replied = true;

      const { user, client, options } = interaction;
      const amount = options.getInteger("amount");

      // Lock check
      if (activeScratch.has(user.id)) {
        return interaction.editReply(
          "❌ Finish your current scratch card first!",
        );
      }
      activeScratch.set(user.id, Date.now());

      // Atomic balance deduction
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
            `❌ You need **${amount} gold** to play.`,
          );
        }
      } catch (err) {
        console.error("Deduction Error:", err);
        activeScratch.delete(user.id);
        return interaction.editReply("❌ Database error. Try again.");
      }

      // Grid builder
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

      // Initial embed
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
        if (i.user.id !== user.id) {
          return i.reply({
            content: "❌ Not your card!",
            ephemeral: true,
          });
        }

        collector.stop("scratched");
        let settled = false;

        try {
          // RNG
          const rng = Math.random() * 100;

          let mult = 0;
          let emoji = "❌";
          let status = "BETTER LUCK NEXT TIME";
          let color = 0xe74c3c;

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

          // --- FIXED REVEAL LOGIC ---
          const nearMisses = [];
          const allSpots = [];

          for (let ri = 0; ri < 5; ri++) {
            for (let ci = 0; ci < 5; ci++) {
              if (ri !== r || ci !== c) {
                allSpots.push({ r: ri, c: ci });
              }
            }
          }

          // Fisher-Yates shuffle
          for (let x = allSpots.length - 1; x > 0; x--) {
            const y = Math.floor(Math.random() * (x + 1));
            [allSpots[x], allSpots[y]] = [allSpots[y], allSpots[x]];
          }

          // Jackpot tease (only if player didn't win jackpot)
          if (mult !== 10) {
            const p = allSpots.pop();
            nearMisses.push({
              pos: `scr_${p.r}_${p.c}`,
              icon: "🏆",
            });
          }

          // Ticket tease count logic
          let ticketCount = 6;
          if (mult === 2) ticketCount = 5;

          for (let k = 0; k < ticketCount; k++) {
            if (allSpots.length === 0) break;

            const p = allSpots.pop();
            nearMisses.push({
              pos: `scr_${p.r}_${p.c}`,
              icon: "🎫",
            });
          }

          const payout = amount * mult;
          const net = payout - amount;

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
                value:
                  `\`\`\`diff\n` +
                  `- Bet: ${amount}\n` +
                  `+ Payout: ${payout}\n` +
                  `${net >= 0 ? "+" : "-"} Profit: ${Math.abs(net)}\n` +
                  `\`\`\``,
                inline: true,
              },
              {
                name: "💳 BALANCE",
                value: `**${finalUser.gold}** gold`,
                inline: true,
              },
            );

          await i.update({
            embeds: [resultEmbed],
            components: getGrid(i.customId, emoji, nearMisses),
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
          console.error("Scratch Error:", err);

          if (!settled) {
            await User.updateOne(
              { userId: user.id },
              { $inc: { gold: amount } },
            );

            try {
              await i.followUp({
                content: "❌ Error occurred. Bet refunded.",
                ephemeral: true,
              });
            } catch {}
          }
        } finally {
          activeScratch.delete(user.id);
        }
      });

      // AFK timeout refund
      collector.on("end", async (collected, reason) => {
        if (reason === "time" && collected.size === 0) {
          activeScratch.delete(user.id);

          await User.updateOne({ userId: user.id }, { $inc: { gold: amount } });

          try {
            const timeoutEmbed = new EmbedBuilder()
              .setTitle("⏱️ Card Expired")
              .setColor(0x34495e)
              .setDescription(`You went AFK. Refunded **${amount} gold**.`);

            if (interaction.isRepliable()) {
              await interaction.editReply({
                embeds: [timeoutEmbed],
                components: getGrid(),
              });
            }
          } catch {}
        }
      });
    } catch (err) {
      console.error("Fatal Scratch Command Error:", err);

      activeScratch.delete(interaction.user?.id);

      try {
        if (!replied) {
          await interaction.reply("❌ Command failed.");
        } else {
          await interaction.editReply(
            "❌ Something went wrong. Please try again.",
          );
        }
      } catch {}
    }
  },
};
