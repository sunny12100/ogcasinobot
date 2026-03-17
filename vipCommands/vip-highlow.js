const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  SlashCommandBuilder,
} = require("discord.js");
const PassUser = require("../models/PassUser");
const crypto = require("crypto");

const activeHighLow = new Set();
const MAX_BET = 5000;

function randomFloat() {
  return crypto.randomBytes(4).readUInt32BE() / 2 ** 32;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("vip-highlow")
    .setDescription("🃏 VIP LOUNGE: High-Low Card Game")
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
    const amount = repeatAmount ?? interaction.options?.getInteger?.("amount");
    const LOUNGE_ROLE = "1483219208962834473";

    if (!interaction.member.roles.cache.has(LOUNGE_ROLE)) {
      return interaction.reply({
        content: "🚫 Restricted access. Purchase an OG Pass first!",
        ephemeral: true,
      });
    }

    if (!amount || amount <= 0 || amount > MAX_BET) {
      const msg = `❌ Bet must be 1 - ${MAX_BET.toLocaleString()}.`;
      return interaction.replied
        ? interaction.followUp({ content: msg, ephemeral: true })
        : interaction.reply({ content: msg, ephemeral: true });
    }

    if (activeHighLow.has(userId)) return;

    if (!interaction.deferred && !interaction.replied)
      await interaction.deferReply();

    activeHighLow.add(userId);
    let failSafe = setTimeout(() => activeHighLow.delete(userId), 35000);

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
          activeHighLow.delete(userId);
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

      const cards = [
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
        "10",
        "J",
        "Q",
        "K",
        "A",
      ];
      const dealerIndex = crypto.randomInt(0, cards.length);
      const dealerCard = cards[dealerIndex];

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("higher")
          .setLabel("Higher")
          .setStyle(ButtonStyle.Success)
          .setEmoji("⬆️"),
        new ButtonBuilder()
          .setCustomId("lower")
          .setLabel("Lower")
          .setStyle(ButtonStyle.Danger)
          .setEmoji("⬇️"),
      );

      const embed = new EmbedBuilder()
        .setTitle("🃏 VIP HIGH-LOW")
        .setColor(0x5865f2)
        .setDescription(
          `💰 **Bet:** \`${amount.toLocaleString()}\` gold\n\nDealer Card: **[ ${dealerCard} ]**\n\nWill the next card be **Higher** or **Lower**?`,
        )
        .setFooter({ text: "Payout: 2× | Tie = Push (Refund)" });

      const msg = await interaction.editReply({
        embeds: [embed],
        components: [row],
      });

      const choice = await msg
        .awaitMessageComponent({
          filter: (i) => i.user.id === userId,
          time: 20000,
        })
        .catch(() => null);

      if (!choice) {
        await PassUser.updateOne({ userId }, { $inc: { passBalance: amount } });
        activeHighLow.delete(userId);
        return interaction.editReply({
          content: "⏲️ **Timed Out:** Refunded.",
          embeds: [],
          components: [],
        });
      }

      await choice.update({
        embeds: [
          new EmbedBuilder()
            .setTitle("🃏 DRAWING...")
            .setColor(0xffaa00)
            .setImage(
              "https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExcDJvZzRicXRqZnJiMjR0MXJ2ZGJhc2puN2JwbW43c21xaHg3NHJpNyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/bG5rDPx76wHMZtsXmr/giphy.gif",
            ),
        ],
        components: [],
      });

      setTimeout(async () => {
        // 100% RTP Logic: 50/50 Chance (Tie handled as Push)
        const wonRoll = randomFloat() < 0.5;
        let userIndex;

        if (wonRoll) {
          if (choice.customId === "higher") {
            userIndex =
              dealerIndex === cards.length - 1
                ? dealerIndex
                : crypto.randomInt(dealerIndex + 1, cards.length);
          } else {
            userIndex =
              dealerIndex === 0
                ? dealerIndex
                : crypto.randomInt(0, dealerIndex);
          }
        } else {
          if (choice.customId === "higher") {
            userIndex = crypto.randomInt(0, dealerIndex + 1);
          } else {
            userIndex = crypto.randomInt(dealerIndex, cards.length);
          }
        }

        const userCard = cards[userIndex];
        const isTie = userIndex === dealerIndex;
        const actuallyWon =
          !isTie &&
          ((choice.customId === "higher" && userIndex > dealerIndex) ||
            (choice.customId === "lower" && userIndex < dealerIndex));

        let payout = isTie ? amount : actuallyWon ? amount * 2 : 0;

        let updated = await PassUser.findOneAndUpdate(
          { userId },
          {
            $inc: {
              passBalance: payout,
              totalWagered: amount,
              totalWon: actuallyWon ? amount : 0,
              totalLost: actuallyWon || isTie ? 0 : amount,
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
          .setTitle(
            isTie ? "🤝 PUSH (TIE)" : actuallyWon ? "🎉 WINNER!" : "💀 LOST",
          )
          .setColor(isTie ? 0xf1c40f : actuallyWon ? 0x2ecc71 : 0xe74c3c)
          .setDescription(
            `Dealer: **${dealerCard}** vs You: **${userCard}**\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n💰 **Payout:** \`${payout.toLocaleString()}\` gold\n🏦 **Balance:** \`${updated.passBalance.toLocaleString()}\` gold${reloadText}`,
          );

        const repeatRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("hl_rep")
            .setLabel("Play Again")
            .setStyle(ButtonStyle.Success)
            .setDisabled(updated.passBalance < amount),
          new ButtonBuilder()
            .setCustomId("hl_quit")
            .setLabel("Quit")
            .setStyle(ButtonStyle.Secondary),
        );

        const finalMsg = await interaction.editReply({
          embeds: [resEmbed],
          components: [repeatRow],
        });
        const next = await finalMsg
          .awaitMessageComponent({
            filter: (b) => b.user.id === userId,
            time: 15000,
          })
          .catch(() => null);

        activeHighLow.delete(userId);
        clearTimeout(failSafe);

        if (next?.customId === "hl_rep") {
          await next.deferUpdate();
          return module.exports.execute(next, amount);
        }
        if (next) await next.update({ components: [] });
      }, 2000);
    } catch (err) {
      activeHighLow.delete(userId);
      console.error(err);
    }
  },
};
