const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
} = require("discord.js");
const PassUser = require("../models/PassUser");

const activeBlackjack = new Set();
const MAX_BET = 5000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("vip-blackjack")
    .setDescription("🎰 VIP LOUNGE: Premium Blackjack with Stats")
    .addIntegerOption((opt) =>
      opt
        .setName("amount")
        .setDescription(`Bet (1-${MAX_BET.toLocaleString()})`)
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(MAX_BET),
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const amount = interaction.options.getInteger("amount");
    const LOUNGE_ROLE = "1483219208962834473";

    if (!interaction.member.roles.cache.has(LOUNGE_ROLE)) {
      return interaction.reply({
        content: "🚫 Restricted access.",
        ephemeral: true,
      });
    }

    if (activeBlackjack.has(userId)) {
      return interaction.reply({
        content: "❌ Game already in progress!",
        ephemeral: true,
      });
    }

    await interaction.deferReply();
    activeBlackjack.add(userId);

    try {
      // 1. Initial Deduction & Record Loss
      let data = await PassUser.findOneAndUpdate(
        { userId, passBalance: { $gte: amount } },
        { $inc: { passBalance: -amount, totalLost: amount, gamesPlayed: 1 } },
        { new: true },
      );

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

      const suits = ["♠️", "❤️", "♣️", "♦️"];
      const values = [
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
      let deck = [];
      for (let i = 0; i < 4; i++)
        suits.forEach((s) => values.forEach((v) => deck.push(`${v}${s}`)));
      deck.sort(() => Math.random() - 0.5);

      let playerHand = [deck.pop(), deck.pop()];
      let dealerHand = [deck.pop(), deck.pop()];
      let totalPot = amount;

      const getVal = (hand) => {
        let total = 0,
          aces = 0;
        hand.forEach((c) => {
          const v = c.replace(/[^\dAJKQ]/g, "");
          if (v === "A") {
            aces++;
            total += 11;
          } else if (["J", "Q", "K"].includes(v)) total += 10;
          else total += parseInt(v);
        });
        while (total > 21 && aces > 0) {
          total -= 10;
          aces--;
        }
        return total;
      };

      const createEmbed = (
        status = "Your move...",
        showDealer = false,
        color = 0x5865f2,
      ) => {
        return new EmbedBuilder()
          .setTitle("🎰 VIP BLACKJACK")
          .setColor(color)
          .setDescription(`**Status:**\n> ${status}\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬`)
          .addFields(
            {
              name: "👤 YOUR HAND",
              value: `**${playerHand.join(" ")}**\nTotal: \`${getVal(playerHand)}\``,
              inline: true,
            },
            {
              name: "🏦 DEALER",
              value: showDealer
                ? `**${dealerHand.join(" ")}**\nTotal: \`${getVal(dealerHand)}\``
                : `**${dealerHand[0]}** 🎴`,
              inline: true,
            },
          )
          .setFooter({
            text: `💰 Stake: ${totalPot.toLocaleString()} | VIP Lounge`,
          });
      };

      // 2. Natural Blackjack Check
      if (getVal(playerHand) === 21) {
        const dVal = getVal(dealerHand);
        let payout = dVal === 21 ? amount : Math.floor(amount * 2.5);

        const updateObj =
          dVal === 21
            ? { $inc: { passBalance: payout, totalLost: -amount } } // Push: Refund Loss
            : { $inc: { passBalance: payout, totalWon: payout } }; // Win: Add Won

        await PassUser.updateOne({ userId }, updateObj);
        activeBlackjack.delete(userId);
        return interaction.editReply({
          embeds: [
            createEmbed(
              dVal === 21 ? "🤝 **PUSH**" : "🔥 **NATURAL BLACKJACK!**",
              true,
              0x2ecc71,
            ),
          ],
          components: [],
        });
      }

      const msg = await interaction.editReply({
        embeds: [createEmbed()],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("hit")
              .setLabel("Hit")
              .setStyle(ButtonStyle.Primary)
              .setEmoji("➕"),
            new ButtonBuilder()
              .setCustomId("stand")
              .setLabel("Stand")
              .setStyle(ButtonStyle.Secondary)
              .setEmoji("✋"),
            new ButtonBuilder()
              .setCustomId("double")
              .setLabel("Double")
              .setStyle(ButtonStyle.Danger)
              .setEmoji("💰")
              .setDisabled(data.passBalance < amount),
          ),
        ],
      });

      const collector = msg.createMessageComponentCollector({
        filter: (i) => i.user.id === userId,
        time: 30000,
      });

      collector.on("collect", async (i) => {
        if (i.customId === "double") {
          // Record the extra loss for the double bet immediately
          await PassUser.updateOne(
            { userId },
            { $inc: { passBalance: -amount, totalLost: amount } },
          );
          totalPot += amount;
          playerHand.push(deck.pop());
          return collector.stop("stand");
        }
        if (i.customId === "hit") {
          playerHand.push(deck.pop());
          if (getVal(playerHand) >= 21) return collector.stop("stand");
          await i.update({
            embeds: [createEmbed()],
            components: [
              new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId("hit")
                  .setLabel("Hit")
                  .setStyle(ButtonStyle.Primary)
                  .setEmoji("➕"),
                new ButtonBuilder()
                  .setCustomId("stand")
                  .setLabel("Stand")
                  .setStyle(ButtonStyle.Secondary)
                  .setEmoji("✋"),
              ),
            ],
          });
        } else if (i.customId === "stand") collector.stop("stand");
      });

      collector.on("end", async (_, reason) => {
        activeBlackjack.delete(userId);
        if (reason === "time")
          return interaction.editReply({
            content: "⌛ Game timed out.",
            components: [],
          });

        let dVal = getVal(dealerHand);
        const pVal = getVal(playerHand);
        if (pVal <= 21)
          while (dVal < 17) {
            dealerHand.push(deck.pop());
            dVal = getVal(dealerHand);
          }

        let result = "",
          finalPayout = 0,
          finalColor = 0x34495e,
          updateQuery = {};

        if (pVal > 21) {
          result = "💀 **BUSTED!**";
          finalColor = 0xe74c3c;
          updateQuery = {}; // Loss already recorded
        } else if (dVal > 21 || pVal > dVal) {
          result = dVal > 21 ? "🎉 **DEALER BUST!**" : "✅ **YOU WIN!**";
          finalPayout = totalPot * 2;
          finalColor = 0x2ecc71;
          updateQuery = {
            $inc: { passBalance: finalPayout, totalWon: finalPayout },
          };
        } else if (pVal === dVal) {
          result = "🤝 **PUSH!**";
          finalPayout = totalPot;
          finalColor = 0xf1c40f;
          updateQuery = {
            $inc: { passBalance: finalPayout, totalLost: -totalPot },
          }; // Refund recorded loss
        } else {
          result = "❌ **HOUSE WINS!**";
          finalColor = 0xe74c3c;
          updateQuery = {}; // Loss already recorded
        }

        const updated = await PassUser.findOneAndUpdate(
          { userId },
          updateQuery,
          { new: true },
        );

        // Bust Protection
        if (updated?.passBalance < 1) {
          await PassUser.updateOne(
            { userId },
            { $set: { passBalance: 50000 } },
          );
        }

        await interaction.editReply({
          embeds: [createEmbed(result, true, finalColor)],
          components: [],
        });
      });
    } catch (err) {
      activeBlackjack.delete(userId);
      console.error(err);
    }
  },
};
