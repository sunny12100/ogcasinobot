const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const User = require("../models/User");
const { logToAudit } = require("../utils/logger");

const activeSlots = new Set();
const MAX_BET = 1000000;

module.exports = {
  name: "slots",
  async execute(interaction, repeatAmount = null) {
    const userId = interaction.user.id;
    const amount = repeatAmount ?? interaction.options?.getInteger?.("amount");

    const sendError = async (content) => {
      const payload = { content, ephemeral: true };
      return interaction.replied || interaction.deferred
        ? interaction.editReply(payload).catch(() => null)
        : interaction.reply(payload).catch(() => null);
    };

    if (!amount || amount <= 0 || amount > MAX_BET)
      return sendError("❌ Invalid bet (1 - 1M gold).");
    if (activeSlots.has(userId))
      return sendError("❌ Spin already in progress!");

    if (!interaction.deferred && !interaction.replied)
      await interaction.deferReply();

    let payoutApplied = false;
    let failSafe;

    try {
      // 1. ATOMIC DEDUCTION
      const userData = await User.findOneAndUpdate(
        { userId, gold: { $gte: amount } },
        { $inc: { gold: -amount } },
        { new: true },
      );

      if (!userData) {
        const existing = await User.findOne({ userId });
        return interaction.editReply({
          content: `❌ Not enough gold! Balance: \`${(existing?.gold ?? 0).toLocaleString()}\``,
        });
      }

      const initialBalance = userData.gold + amount;
      activeSlots.add(userId);
      failSafe = setTimeout(() => activeSlots.delete(userId), 35000);

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("🎰 SPINNING...")
            .setColor(0xffaa00)
            .setImage(
              "https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExd2l6MzhjMGF0cW12aW9nOTlrdG1odnhjOHY0NnVna3VraHBmdGZsZCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/Ce18KspdcaxaKuZ1HC/giphy.gif",
            ),
        ],
      });

      // 2. MATH ENGINE (Casino-Grade RTP)
      const symbols = ["🍒", "🍋", "🍇", "🔔", "💎", "7️⃣"];
      const roll = Math.random() * 100;
      let r1,
        r2,
        r3,
        won = false,
        mult = 0;

      if (roll <= 0.5) {
        won = true;
        mult = 10;
        r1 = r2 = r3 = "7️⃣";
      } else if (roll <= 3.5) {
        won = true;
        mult = 5;
        r1 = r2 = r3 = "💎";
      } else if (roll <= 25.5) {
        won = true;
        mult = 1.5;
        const fruit = ["🍒", "🍋", "🍇", "🔔"][Math.floor(Math.random() * 4)];
        r1 = r2 = r3 = fruit; // Clean synchronization
      } else {
        won = false;
        r1 = symbols[Math.floor(Math.random() * 6)];
        r2 = symbols[Math.floor(Math.random() * 6)];
        r3 = symbols[Math.floor(Math.random() * 6)];
        if (r1 === r2 && r2 === r3) r3 = symbols[(symbols.indexOf(r3) + 1) % 6];
      }

      const payout = won ? Math.floor(amount * mult) : 0;
      const netChange = won ? payout - amount : -amount;

      // 3. SETTLEMENT TIMEOUT
      setTimeout(async () => {
        try {
          const updatedUser = await User.findOneAndUpdate(
            { userId },
            { $inc: { gold: payout } },
            { new: true },
          );

          if (!updatedUser) throw new Error("DB_PAYOUT_FAIL");
          payoutApplied = true;

          const resultEmbed = new EmbedBuilder()
            .setTitle(won ? "🎉 WINNER!" : "💀 BUSTED")
            .setColor(won ? 0x2ecc71 : 0xe74c3c)
            .setDescription(
              `## [ ${r1} | ${r2} | ${r3} ]\n\n💰 **Change:** \`${netChange >= 0 ? "+" : ""}${netChange.toLocaleString()}\` gold\n🏦 **Balance:** \`${updatedUser.gold.toLocaleString()}\` gold`,
            );

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("slots_rep")
              .setLabel("Spin Again")
              .setStyle(ButtonStyle.Success)
              .setDisabled(updatedUser.gold < amount),
            new ButtonBuilder()
              .setCustomId("slots_quit")
              .setLabel("Quit")
              .setStyle(ButtonStyle.Secondary),
          );

          const finalMsg = await interaction.editReply({
            embeds: [resultEmbed],
            components: [row],
          });

          await logToAudit(interaction.client, {
            userId,
            bet: amount,
            amount: netChange,
            oldBalance: initialBalance,
            newBalance: updatedUser.gold,
            reason: `Slots: ${won ? "WIN" : "LOSS"} [${r1}${r2}${r3}]`,
          }).catch(() => null);

          const collector = finalMsg.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 15000,
          });

          collector.on("collect", async (i) => {
            if (i.user.id !== userId)
              return i.reply({ content: "Not yours!", ephemeral: true });

            collector.stop("replay");
            activeSlots.delete(userId);
            clearTimeout(failSafe);

            if (i.customId === "slots_rep") {
              await i.deferUpdate();
              return module.exports.execute(i, Number(amount));
            }
            await i.update({ components: [] });
          });
        } catch (err) {
          console.error("[Slots Settle Error]", err);
          if (!payoutApplied) {
            await User.updateOne({ userId }, { $inc: { gold: amount } }).catch(
              () => null,
            );
          }
        } finally {
          activeSlots.delete(userId);
          clearTimeout(failSafe);
        }
      }, 2000);
    } catch (err) {
      console.error("[Slots Fatal Error]", err);
      activeSlots.delete(userId);
      if (failSafe) clearTimeout(failSafe);
    }
  },
};
