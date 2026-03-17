const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
} = require("discord.js");
const PassUser = require("../models/PassUser");

const activeSlots = new Set();
const MAX_BET = 5000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("vip-slots")
    .setDescription("🎰 VIP LOUNGE: 100% RTP Slots")
    .addIntegerOption((opt) =>
      opt
        .setName("amount")
        .setDescription(`Gold to bet (1-${MAX_BET.toLocaleString()})`)
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(MAX_BET),
    ),

  async execute(interaction, repeatAmount = null) {
    const userId = interaction.user.id;
    const amount = repeatAmount ?? interaction.options?.getInteger("amount");
    const LOUNGE_ROLE = "1483219208962834473";

    // 1. Initial Checks
    if (!interaction.member.roles.cache.has(LOUNGE_ROLE)) {
      return interaction.reply({
        content: "🚫 Restricted access.",
        ephemeral: true,
      });
    }

    if (activeSlots.has(userId) && !repeatAmount) {
      return interaction.reply({
        content: "❌ You already have a game in progress!",
        ephemeral: true,
      });
    }

    if (!interaction.deferred && !interaction.replied)
      await interaction.deferReply();
    activeSlots.add(userId);

    try {
      // 2. Balance & Deduction (Record Loss immediately for security)
      let data = await PassUser.findOneAndUpdate(
        { userId, passBalance: { $gte: amount } },
        { $inc: { passBalance: -amount, totalLost: amount, gamesPlayed: 1 } },
        { new: true },
      );

      // Auto-Reload if user is broke
      if (!data) {
        data = await PassUser.findOneAndUpdate(
          { userId },
          { $set: { passBalance: 50000 } },
          { upsert: true, new: true },
        );
        data = await PassUser.findOneAndUpdate(
          { userId },
          { $inc: { passBalance: -amount, totalLost: amount, gamesPlayed: 1 } },
          { new: true },
        );
      }

      // Spinning UI
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

      // 3. Math Engine
      const symbols = ["🍒", "🍋", "🍇", "🔔", "💎", "7️⃣"];
      const roll = Math.random() * 100;
      let r1,
        r2,
        r3,
        won = false,
        mult = 0;

      if (roll <= 1) {
        // 1% Jackpot
        won = true;
        mult = 10;
        r1 = r2 = r3 = "7️⃣";
      } else if (roll <= 10) {
        // 9% Big Win
        won = true;
        mult = 5;
        r1 = r2 = r3 = "💎";
      } else if (roll <= 40) {
        // 30% Small Win
        won = true;
        mult = 1.5;
        const fruit = ["🍒", "🍋", "🍇", "🔔"][Math.floor(Math.random() * 4)];
        r1 = r2 = r3 = fruit;
      } else {
        // 60% Loss
        won = false;
        r1 = symbols[Math.floor(Math.random() * 6)];
        r2 = symbols[Math.floor(Math.random() * 6)];
        r3 = symbols[Math.floor(Math.random() * 6)];
        if (r1 === r2 && r2 === r3) r3 = symbols[(symbols.indexOf(r3) + 1) % 6];
      }

      const payout = Math.floor(amount * mult);

      // 4. Update Win Stats & Result
      setTimeout(async () => {
        const updateObj = won
          ? { $inc: { passBalance: payout, totalWon: payout } }
          : {}; // Loss already recorded at start

        let updated = await PassUser.findOneAndUpdate({ userId }, updateObj, {
          new: true,
        });

        // Final Reload check
        if (updated.passBalance < 1) {
          updated = await PassUser.findOneAndUpdate(
            { userId },
            { $set: { passBalance: 50000 } },
            { new: true },
          );
        }

        const resEmbed = new EmbedBuilder()
          .setTitle(won ? "🎉 VIP SLOTS WIN!" : "💀 BUSTED")
          .setColor(won ? 0x2ecc71 : 0xe74c3c)
          .setDescription(
            `## [ ${r1} | ${r2} | ${r3} ]\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n💰 **Payout:** \`${payout.toLocaleString()}\` gold\n🏦 **Balance:** \`${updated.passBalance.toLocaleString()}\` gold`,
          )
          .setFooter({
            text: `Bet: ${amount.toLocaleString()} gold | 100% RTP Engine`,
          });

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

        // Collector for Replay
        try {
          const next = await finalMsg.awaitMessageComponent({
            filter: (i) => i.user.id === userId,
            time: 15000,
          });

          activeSlots.delete(userId);

          if (next.customId === "slots_rep") {
            await next.deferUpdate();
            return module.exports.execute(next, amount);
          } else {
            await next.update({ components: [] });
          }
        } catch (e) {
          activeSlots.delete(userId);
          await interaction.editReply({ components: [] }).catch(() => null);
        }
      }, 2000);
    } catch (err) {
      activeSlots.delete(userId);
      console.error(err);
    }
  },
};
