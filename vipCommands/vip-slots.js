const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const PassUser = require("../models/PassUser");
const crypto = require("crypto");

const activeSlots = new Set();
const MAX_BET = 5000;

module.exports = {
  name: "vip-slots",
  async execute(interaction, repeatAmount = null) {
    const userId = interaction.user.id;
    const amount = repeatAmount ?? interaction.options?.getInteger?.("amount");
    const LOUNGE_ROLE = "1483219208962834473";

    if (!interaction.member.roles.cache.has(LOUNGE_ROLE)) {
      return interaction.reply({
        content: "🚫 Restricted access.",
        ephemeral: true,
      });
    }

    if (!amount || amount <= 0 || amount > MAX_BET) {
      const msg = `❌ Bet must be 1 - ${MAX_BET.toLocaleString()}.`;
      return interaction.replied
        ? interaction.followUp({ content: msg, ephemeral: true })
        : interaction.reply({ content: msg, ephemeral: true });
    }

    if (activeSlots.has(userId)) return;

    if (!interaction.deferred && !interaction.replied)
      await interaction.deferReply();

    activeSlots.add(userId);
    let failSafe = setTimeout(() => activeSlots.delete(userId), 30000);

    try {
      // 1. SELF-HEALING BALANCE CHECK
      let data = await PassUser.findOne({ userId });
      if (!data) {
        data = await PassUser.create({ userId, passBalance: 1000000 });
      } else if (data.passBalance < amount) {
        if (data.passBalance <= 0) {
          data = await PassUser.findOneAndUpdate(
            { userId },
            { $set: { passBalance: 50000 } },
            { new: true },
          );
        } else {
          activeSlots.delete(userId);
          clearTimeout(failSafe);
          return interaction.editReply({
            content: `❌ Not enough gold! Balance: \`${data.passBalance.toLocaleString()}\``,
          });
        }
      }

      // 2. ATOMIC DEDUCTION
      data = await PassUser.findOneAndUpdate(
        { userId, passBalance: { $gte: amount } },
        { $inc: { passBalance: -amount } },
        { new: true },
      );

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("🎰 SPINNING...")
            .setColor(0xffaa00)
            .setImage(
              "https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExd2l6MzhjMGF0cW12aW9nOTlrdG1odnhjOHY0NnVna3VraHBmdGZsZCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/Ce18KspdcaxaKuZ1HC/giphy.gif",
            ),
        ],
        components: [],
      });

      // 3. 100% RTP MATH ENGINE
      const symbols = ["🍒", "🍋", "🍇", "🔔", "💎", "7️⃣"];
      const roll = Math.random() * 100;
      let r1,
        r2,
        r3,
        won = false,
        mult = 0;

      // RTP Breakdown: 1% Jackpot (10x), 9% Big Win (5x), 30% Small Win (1.5x)
      // Total Return: (0.01 * 10) + (0.09 * 5) + (0.30 * 1.5) = 0.1 + 0.45 + 0.45 = 1.0 (100% RTP)
      if (roll <= 1) {
        won = true;
        mult = 10;
        r1 = r2 = r3 = "7️⃣";
      } else if (roll <= 10) {
        won = true;
        mult = 5;
        r1 = r2 = r3 = "💎";
      } else if (roll <= 40) {
        won = true;
        mult = 1.5;
        const fruit = ["🍒", "🍋", "🍇", "🔔"][Math.floor(Math.random() * 4)];
        r1 = r2 = r3 = fruit;
      } else {
        won = false;
        r1 = symbols[Math.floor(Math.random() * 6)];
        r2 = symbols[Math.floor(Math.random() * 6)];
        r3 = symbols[Math.floor(Math.random() * 6)];
        if (r1 === r2 && r2 === r3) r3 = symbols[(symbols.indexOf(r3) + 1) % 6];
      }

      const payout = Math.floor(amount * mult);

      setTimeout(async () => {
        let updated = await PassUser.findOneAndUpdate(
          { userId },
          {
            $inc: {
              passBalance: payout,
              totalWagered: amount,
              totalWon: won ? payout : 0,
              totalLost: won ? 0 : amount,
              gamesPlayed: 1,
            },
          },
          { new: true },
        );

        let reloadText = "";
        if (updated.passBalance < 1) {
          updated = await PassUser.findOneAndUpdate(
            { userId },
            { $set: { passBalance: 50000 } },
            { new: true },
          );
          reloadText = "\n\n*Reloaded 50,000 gold (Bust protection).*";
        }

        const resEmbed = new EmbedBuilder()
          .setTitle(won ? "🎉 WINNER!" : "💀 BUSTED")
          .setColor(won ? 0x2ecc71 : 0xe74c3c)
          .setDescription(
            `## [ ${r1} | ${r2} | ${r3} ]\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n💰 **Payout:** \`${payout.toLocaleString()}\` gold\n🏦 **Balance:** \`${updated.passBalance.toLocaleString()}\` gold${reloadText}`,
          );

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("slots_rep")
            .setLabel("Spin Again")
            .setStyle(ButtonStyle.Success)
            .setDisabled(updated.passBalance < amount),
          new ButtonBuilder()
            .setCustomId("slots_quit")
            .setLabel("Quit")
            .setStyle(ButtonStyle.Secondary),
        );

        const finalMsg = await interaction.editReply({
          embeds: [resEmbed],
          components: [row],
        });

        // Handle Repeat/Quit
        const next = await finalMsg
          .awaitMessageComponent({
            filter: (i) => i.user.id === userId,
            time: 15000,
          })
          .catch(() => null);

        activeSlots.delete(userId);
        clearTimeout(failSafe);

        if (next?.customId === "slots_rep") {
          await next.deferUpdate();
          return module.exports.execute(next, amount);
        }
        if (next) await next.update({ components: [] });
      }, 2000);
    } catch (err) {
      activeSlots.delete(userId);
      console.error(err);
    }
  },
};
