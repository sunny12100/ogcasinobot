const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const User = require("../models/User");
const { logToAudit } = require("../utils/logger");

const activeAviator = new Set();

module.exports = {
  name: "aviator",
  async execute(interaction) {
    const userId = interaction.user.id;
    const amount = interaction.options.getInteger("amount");

    if (!interaction.replied && !interaction.deferred)
      await interaction.deferReply();

    if (activeAviator.has(userId)) {
      return interaction.editReply({
        content: "❌ Flight already in progress!",
        ephemeral: true,
      });
    }

    let settled = false;
    let gameActive = true;
    let failSafe; // Define in scope for cleanup

    try {
      // 1. ATOMIC DEDUCTION
      const userData = await User.findOneAndUpdate(
        { userId, gold: { $gte: amount } },
        { $inc: { gold: -amount } },
        { new: true },
      );

      if (!userData)
        return interaction.editReply({ content: "❌ Not enough gold!" });

      const initialBalance = userData.gold + amount;

      // 2. FAILSAFE LOCK: Cleans up orphaned sessions even if the process hangs
      activeAviator.add(userId);
      failSafe = setTimeout(() => {
        activeAviator.delete(userId);
      }, 70000); // 70-second hard limit (Collector is 60s)

      // 3. CRASH LOGIC
      const roll = Math.random() * 100;
      let crashPoint;
      if (roll < 10) crashPoint = 1.0;
      else if (roll < 50) crashPoint = 1.1 + Math.random() * 0.4;
      else if (roll < 90) crashPoint = 1.5 + Math.random() * 2.0;
      else crashPoint = 3.5 + Math.random() * 15.0;

      crashPoint = parseFloat(crashPoint.toFixed(2));
      let currentMultiplier = 1.0;

      const createEmbed = (
        multiplier,
        status = "Jet is gaining altitude...",
        color = 0x9b59b6,
      ) => {
        return new EmbedBuilder()
          .setTitle("✈️ AVIATOR: LUCKY JET")
          .setColor(color)
          .setDescription(
            `### Multiplier: \`${multiplier.toFixed(2)}x\`\n> ${status}`,
          )
          .addFields({
            name: "Potential Payout",
            value: `\`${Math.floor(amount * multiplier).toLocaleString()}\` gold`,
          })
          .setImage(
            "https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExeTRmenczcGU4eXNvbmxiNGtreDNmZnprczhjcGZqZzFnZzk0bmMyNSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/W307DdkjIsRHVWvoFE/giphy.gif",
          )
          .setFooter({
            text: `Bet: ${amount.toLocaleString()} | Infrastructure Hardened`,
          });
      };

      const gameRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("cashout")
          .setLabel("CASH OUT")
          .setStyle(ButtonStyle.Success)
          .setEmoji("💰"),
      );

      // Instant Crash Handler
      if (crashPoint <= 1.0) {
        clearTimeout(failSafe);
        activeAviator.delete(userId);
        settled = true;

        await logToAudit(interaction.client, {
          userId,
          bet: amount,
          amount: -amount,
          oldBalance: initialBalance,
          newBalance: userData.gold,
          reason: "Aviator: Instant crash",
        });

        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("💥 INSTANT CRASH")
              .setColor(0xe74c3c)
              .setDescription(
                `The plane stalled! **Loss:** \`-${amount}\` gold`,
              ),
          ],
          components: [],
        });
      }

      const msg = await interaction.editReply({
        embeds: [createEmbed(currentMultiplier)],
        components: [gameRow],
      });
      const collector = msg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60000,
      });

      // Jittered growth loop
      const runLoop = async () => {
        if (!gameActive || settled) return;
        const growthEntropy = 0.035 + Math.random() * 0.015;
        currentMultiplier += growthEntropy + currentMultiplier * growthEntropy;

        if (currentMultiplier >= crashPoint) {
          currentMultiplier = crashPoint;
          gameActive = false;
          collector.stop("crashed");
          return;
        }

        await interaction
          .editReply({ embeds: [createEmbed(currentMultiplier)] })
          .catch(() => {
            gameActive = false;
          });
        if (gameActive) setTimeout(runLoop, 1000 + Math.random() * 800);
      };

      setTimeout(runLoop, 1200);

      collector.on("collect", async (i) => {
        if (i.user.id !== userId)
          return i.reply({ content: "Not your flight!", ephemeral: true });
        if (currentMultiplier < 1.1)
          return i.reply({
            content: "⏳ Too early! (Min 1.10x)",
            ephemeral: true,
          });
        gameActive = false;
        await i.deferUpdate();
        collector.stop("cashed_out");
      });

      collector.on("end", async (_, reason) => {
        if (settled) return;
        settled = true;

        // CLEANUP: Always clear timeout and remove from active list
        clearTimeout(failSafe);
        activeAviator.delete(userId);
        gameActive = false;

        try {
          if (reason === "cashed_out") {
            let effectiveMultiplier = currentMultiplier;
            if (currentMultiplier < 1.25) effectiveMultiplier *= 0.9; // Early exit tax

            const winAmount = Math.floor(amount * effectiveMultiplier);
            const finalUser = await User.findOneAndUpdate(
              { userId },
              { $inc: { gold: winAmount } },
              { new: true },
            );

            if (!finalUser) throw new Error("Database update failed");

            // UI FALLBACK PATTERN: Handles expired interaction tokens
            const profitEmbed = new EmbedBuilder()
              .setTitle("💰 PROFIT SECURED")
              .setColor(0x2ecc71)
              .setDescription(
                `💵 **Exited at \`${currentMultiplier.toFixed(2)}x\`**\nProfit: \`+${(winAmount - amount).toLocaleString()}\` gold`,
              );

            await interaction
              .editReply({ embeds: [profitEmbed], components: [] })
              .catch(async () => {
                await interaction.followUp({
                  content: `✅ **${interaction.user.username}**, you cashed out for **${winAmount}** gold! (Balance updated)`,
                  ephemeral: true,
                });
              });

            // AWAITED AUDIT: Guaranteed log before resolving
            await logToAudit(interaction.client, {
              userId,
              bet: amount,
              amount: winAmount - amount,
              oldBalance: initialBalance,
              newBalance: finalUser.gold,
              reason: `Aviator: Success`,
            });
          } else {
            const finalUser = await User.findOne({ userId });
            const crashEmbed = new EmbedBuilder()
              .setTitle("🔥 KABOOM")
              .setColor(0xe74c3c)
              .setDescription(
                `💥 **Crashed at \`${crashPoint.toFixed(2)}x\`**\nLoss: \`-${amount}\` gold`,
              );

            await interaction
              .editReply({ embeds: [crashEmbed], components: [] })
              .catch(() => null);

            await logToAudit(interaction.client, {
              userId,
              bet: amount,
              amount: -amount,
              oldBalance: initialBalance,
              newBalance: finalUser?.gold || 0,
              reason: `Aviator: Crash`,
            });
          }
        } catch (err) {
          console.error("SETTLEMENT ERROR:", err);
        }
      });
    } catch (error) {
      console.error("FATAL ERROR:", error);
      clearTimeout(failSafe);
      activeAviator.delete(userId);
    }
  },
};
