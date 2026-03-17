const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  SlashCommandBuilder,
} = require("discord.js");
const PassUser = require("../models/PassUser");

const activeBlackjack = new Set();
const MAX_BET = 5000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("vip-blackjack")
    .setDescription("🃏 VIP LOUNGE: 100% RTP Blackjack")
    .addIntegerOption((opt) =>
      opt
        .setName("amount")
        .setDescription(`Gold to bet (1-${MAX_BET})`)
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(MAX_BET),
    ),

  async execute(interaction, repeatAmount = null) {
    const userId = interaction.user.id;
    const amount = repeatAmount ?? interaction.options?.getInteger("amount");
    const LOUNGE_ROLE = "1483219208962834473";

    if (!interaction.member.roles.cache.has(LOUNGE_ROLE)) {
      return interaction.reply({
        content: "🚫 Restricted access. Purchase an OG Pass first!",
        ephemeral: true,
      });
    }

    if (activeBlackjack.has(userId)) return;
    if (!interaction.deferred && !interaction.replied)
      await interaction.deferReply();

    try {
      // 1. SELF-HEALING BALANCE & DEDUCTION
      let data = await PassUser.findOne({ userId });
      if (!data || data.passBalance < amount) {
        data = await PassUser.findOneAndUpdate(
          { userId },
          { $set: { passBalance: Math.max(data?.passBalance || 0, 50000) } },
          { upsert: true, new: true },
        );
      }

      data = await PassUser.findOneAndUpdate(
        { userId, passBalance: { $gte: amount } },
        { $inc: { passBalance: -amount } },
        { new: true },
      );
      activeBlackjack.add(userId);

      // 2. DECK & DEALING
      const generateDeck = () => {
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
        let newDeck = [];
        for (let i = 0; i < 4; i++)
          suits.forEach((s) => values.forEach((v) => newDeck.push(`${v}${s}`)));
        return newDeck.sort(() => Math.random() - 0.5);
      };

      let deck = generateDeck();
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

      const createEmbed = (status = "Your move!", showDealer = false) => {
        const pVal = getVal(playerHand);
        const dVal = getVal(dealerHand);
        return new EmbedBuilder()
          .setTitle("🃏 VIP BLACKJACK")
          .setColor(pVal > 21 ? 0xe74c3c : 0x5865f2)
          .setDescription(`**STATUS:** ${status}\n${"▬".repeat(20)}`)
          .addFields(
            {
              name: "👤 PLAYER",
              value: `**${playerHand.join(" ")}**\nValue: \`${pVal}\``,
              inline: true,
            },
            {
              name: "🏦 DEALER",
              value: showDealer
                ? `**${dealerHand.join(" ")}**\nValue: \`${dVal}\``
                : `**${dealerHand[0]}** ❓`,
              inline: true,
            },
          )
          .setFooter({
            text: `💰 Current Bet: ${totalPot.toLocaleString()} gold`,
          });
      };

      const buildButtons = (isFirstMove) => {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("hit")
            .setLabel("Hit")
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId("stand")
            .setLabel("Stand")
            .setStyle(ButtonStyle.Secondary),
        );
        if (isFirstMove && data.passBalance >= amount) {
          row.addComponents(
            new ButtonBuilder()
              .setCustomId("double")
              .setLabel("Double Down")
              .setStyle(ButtonStyle.Danger),
          );
        }
        return row;
      };

      // 3. INITIAL CHECK (NATURAL BLACKJACK)
      if (getVal(playerHand) === 21) {
        const dVal = getVal(dealerHand);
        const payout = dVal === 21 ? amount : Math.floor(amount * 2.5);
        const final = await PassUser.findOneAndUpdate(
          { userId },
          { $inc: { passBalance: payout } },
          { new: true },
        );
        activeBlackjack.delete(userId);
        return interaction.editReply({
          embeds: [
            createEmbed(
              dVal === 21 ? "🤝 PUSH (Double Blackjack)" : "🎉 BLACKJACK!",
              true,
            ),
          ],
          components: [],
        });
      }

      const msg = await interaction.editReply({
        embeds: [createEmbed()],
        components: [buildButtons(true)],
      });
      const collector = msg.createMessageComponentCollector({
        filter: (i) => i.user.id === userId,
        time: 30000,
      });

      collector.on("collect", async (i) => {
        if (i.customId === "double") {
          await PassUser.updateOne(
            { userId },
            { $inc: { passBalance: -amount } },
          );
          totalPot += amount;
          playerHand.push(deck.pop());
          collector.stop("stand");
        } else if (i.customId === "hit") {
          playerHand.push(deck.pop());
          if (getVal(playerHand) >= 21) return collector.stop("stand");
          await i.update({
            embeds: [createEmbed()],
            components: [buildButtons(false)],
          });
        } else if (i.customId === "stand") {
          collector.stop("stand");
        }
      });

      collector.on("end", async (_, reason) => {
        activeBlackjack.delete(userId);
        if (reason === "time")
          return interaction.editReply({
            content: "⌛ Timed out. House wins by default.",
            components: [],
          });

        // Dealer Turn
        let dVal = getVal(dealerHand);
        const pVal = getVal(playerHand);

        if (pVal <= 21) {
          while (dVal < 17) {
            dealerHand.push(deck.pop());
            dVal = getVal(dealerHand);
          }
        }

        let result = "";
        let winMult = 0;

        if (pVal > 21) {
          result = "💀 BUSTED";
          winMult = 0;
        } else if (dVal > 21) {
          result = "🎉 DEALER BUSTED!";
          winMult = 2;
        } else if (pVal > dVal) {
          result = "✅ YOU WIN!";
          winMult = 2;
        } else if (pVal === dVal) {
          result = "🤝 PUSH";
          winMult = 1;
        } else {
          result = "❌ HOUSE WINS";
          winMult = 0;
        }

        const finalPayout = Math.floor(totalPot * winMult);
        let updated = await PassUser.findOneAndUpdate(
          { userId },
          { $inc: { passBalance: finalPayout } },
          { new: true },
        );

        // Reload if bust
        let reloadText = "";
        if (updated.passBalance < 1) {
          updated = await PassUser.findOneAndUpdate(
            { userId },
            { $set: { passBalance: 50000 } },
            { new: true },
          );
          reloadText = "\n\n*Reloaded 50,000 gold (Bust protection).*";
        }

        const finalRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("bj_rep")
            .setLabel("Play Again")
            .setStyle(ButtonStyle.Success)
            .setDisabled(updated.passBalance < amount),
          new ButtonBuilder()
            .setCustomId("bj_quit")
            .setLabel("Quit")
            .setStyle(ButtonStyle.Secondary),
        );

        const finalMsg = await interaction.editReply({
          embeds: [createEmbed(result + reloadText, true)],
          components: [finalRow],
        });

        const next = await finalMsg
          .awaitMessageComponent({
            filter: (b) => b.user.id === userId,
            time: 10000,
          })
          .catch(() => null);
        if (next?.customId === "bj_rep") {
          await next.deferUpdate();
          return module.exports.execute(next, amount);
        }
        await finalMsg.edit({ components: [] }).catch(() => null);
      });
    } catch (err) {
      activeBlackjack.delete(userId);
      console.error(err);
    }
  },
};
