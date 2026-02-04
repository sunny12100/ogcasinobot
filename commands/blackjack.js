const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const User = require("../models/User");
const { logToAudit } = require("../utils/logger");

const activeBlackjack = new Set();
const MAX_BET = 200;

module.exports = {
  name: "blackjack",
  async execute(interaction) {
    const userId = interaction.user.id;
    const currentBet = interaction.options.getInteger("amount");

    if (currentBet > MAX_BET)
      return interaction.reply({
        content: `❌ Max bet is ${MAX_BET}!`,
        ephemeral: true,
      });

    if (activeBlackjack.has(userId))
      return interaction.reply({
        content: "❌ Game already in progress!",
        ephemeral: true,
      });

    await interaction.deferReply();
    const userData = await User.findOne({ userId });
    if (!userData || userData.gold < currentBet) {
      return interaction.editReply({ content: "❌ Not enough gold!" });
    }

    activeBlackjack.add(userId);
    const initialBalance = userData.gold;
    await User.updateOne({ userId }, { $inc: { gold: -currentBet } });

    let currentPot = currentBet;
    let isProcessing = false;

    // ---- HAND STATES
    let playerHand = [];
    let dealerHand = [];
    let splitHands = null;
    let activeHandIndex = 0;

    // --- DECK GENERATION ---
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
    for (let i = 0; i < 6; i++) {
      for (const s of suits) for (const v of values) deck.push(`\`${v}${s}\``);
    }
    deck.sort(() => Math.random() - 0.5);

    const getVal = (hand) => {
      let total = 0;
      let aces = 0;
      for (const card of hand) {
        const v = card.replace(/[`♠️❤️♣️♦️\s]/g, "");
        if (v === "A") {
          aces++;
          total += 1;
        } else if (["J", "Q", "K"].includes(v)) {
          total += 10;
        } else {
          total += parseInt(v);
        }
      }
      while (aces > 0 && total + 10 <= 21) {
        total += 10;
        aces--;
      }
      return total;
    };

    const shouldBiasDealer = currentBet >= 100 && Math.random() < 0.45;
    const riggedPop = (bias = false, handVal = 0) => {
      if (!bias || handVal < 12) return deck.pop();
      const riskyCards = deck.filter((card) => {
        const v = card.replace(/[`♠️❤️♣️♦️\s]/g, "");
        const val =
          v === "A" ? 11 : ["J", "Q", "K"].includes(v) ? 10 : parseInt(v);
        return handVal + val > 21;
      });
      if (riskyCards.length && Math.random() < 0.35) {
        const card = riskyCards[Math.floor(Math.random() * riskyCards.length)];
        deck.splice(deck.indexOf(card), 1);
        return card;
      }
      return deck.pop();
    };

    // Initial Deal
    playerHand = [deck.pop(), deck.pop()];
    dealerHand = [deck.pop(), deck.pop()];

    const createEmbed = (
      title,
      color,
      showDealer = false,
      status = "Your move!",
    ) => {
      const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor(color)
        .setDescription(`**GAME STATUS**\n> ${status}\n${"▬".repeat(25)}`)
        .addFields(
          {
            name: "👤 PLAYER",
            value: `**${playerHand.join(" ")}**\nValue: \`${getVal(playerHand)}\``,
            inline: true,
          },
          {
            name: "🏦 DEALER",
            value: showDealer
              ? `**${dealerHand.join(" ")}**\nValue: \`${getVal(dealerHand)}\``
              : `**${dealerHand[0]}** \`??\``,
            inline: true,
          },
        )
        .setFooter({ text: `💰 Total Bet: ${currentPot}` });

      if (splitHands) {
        const otherHandIdx = activeHandIndex === 0 ? 1 : 0;
        embed.addFields({
          name: `📦 OTHER HAND (Hand ${otherHandIdx + 1})`,
          value: `Value: \`${getVal(splitHands[otherHandIdx])}\``,
          inline: false,
        });
      }
      return embed;
    };

    const buildButtons = async () => {
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
      const freshUser = await User.findOne({ userId });
      const card1 = playerHand[0]?.replace(/[`♠️❤️♣️♦️\s]/g, "");
      const card2 = playerHand[1]?.replace(/[`♠️❤️♣️♦️\s]/g, "");

      const canSplit =
        playerHand.length === 2 &&
        card1 === card2 &&
        !splitHands &&
        freshUser.gold >= currentBet;
      if (canSplit) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId("split")
            .setLabel("Split")
            .setStyle(ButtonStyle.Danger),
        );
      }
      return row;
    };

    const msg = await interaction.editReply({
      embeds: [createEmbed("🃏 BLACKJACK", 0x5865f2)],
      components: [await buildButtons()],
    });

    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 60000,
    });

    collector.on("collect", async (i) => {
      if (i.user.id !== userId)
        return i.reply({ content: "Not your game!", ephemeral: true });
      if (isProcessing) return;
      isProcessing = true;

      if (i.customId === "hit") {
        playerHand.push(riggedPop(shouldBiasDealer, getVal(playerHand)));
        if (getVal(playerHand) >= 21) {
          if (splitHands && activeHandIndex === 0) {
            activeHandIndex = 1;
            playerHand = splitHands[1];
            await i.update({
              embeds: [createEmbed("🃏 BLACKJACK (HAND 2)", 0x5865f2)],
              components: [await buildButtons()],
            });
            isProcessing = false;
          } else {
            collector.stop("ended");
            await i.deferUpdate().catch(() => null);
          }
        } else {
          await i.update({
            embeds: [
              createEmbed(
                splitHands ? `🃏 HAND ${activeHandIndex + 1}` : "🃏 BLACKJACK",
                0x5865f2,
              ),
            ],
            components: [await buildButtons()],
          });
          isProcessing = false;
        }
      } else if (i.customId === "split") {
        await User.updateOne({ userId }, { $inc: { gold: -currentBet } });
        currentPot += currentBet;
        splitHands = [
          [playerHand[0], deck.pop()],
          [playerHand[1], deck.pop()],
        ];
        playerHand = splitHands[0];
        activeHandIndex = 0;
        await i.update({
          embeds: [createEmbed("🃏 BLACKJACK (HAND 1)", 0x5865f2)],
          components: [await buildButtons()],
        });
        isProcessing = false;
      } else if (i.customId === "stand") {
        if (splitHands && activeHandIndex === 0) {
          activeHandIndex = 1;
          playerHand = splitHands[1];
          await i.update({
            embeds: [createEmbed("🃏 BLACKJACK (HAND 2)", 0x5865f2)],
            components: [await buildButtons()],
          });
          isProcessing = false;
        } else {
          collector.stop("ended");
          await i.deferUpdate().catch(() => null);
        }
      }
    });

    collector.on("end", async () => {
      activeBlackjack.delete(userId);
      let dVal = getVal(dealerHand);
      const handsToEvaluate = splitHands ? splitHands : [playerHand];

      // Dealer logic: Only hits if at least one player hand is still valid
      const playerBustedAll = handsToEvaluate.every((h) => getVal(h) > 21);
      if (!playerBustedAll) {
        while (dVal < 17) {
          dealerHand.push(deck.pop());
          dVal = getVal(dealerHand);
        }
      }

      let totalPayout = 0;
      let resultSummary = [];

      for (let i = 0; i < handsToEvaluate.length; i++) {
        const pVal = getVal(handsToEvaluate[i]);
        const handLabel = splitHands ? `Hand ${i + 1}` : "Game";
        const handBet = currentBet;

        if (pVal > 21) resultSummary.push(`${handLabel}: 💥 BUST`);
        else if (dVal > 21 || pVal > dVal) {
          totalPayout += handBet * 2;
          resultSummary.push(`${handLabel}: ✅ WIN`);
        } else if (pVal === dVal) {
          totalPayout += handBet;
          resultSummary.push(`${handLabel}: 🤝 PUSH`);
        } else resultSummary.push(`${handLabel}: ❌ LOSE`);
      }

      const finalUser = await User.findOneAndUpdate(
        { userId },
        { $inc: { gold: totalPayout } },
        { new: true },
      );
      const statusText = resultSummary.join("\n");

      await interaction
        .editReply({
          embeds: [
            createEmbed(
              "🃏 FINAL RESULT",
              totalPayout >= currentPot ? 0x2ecc71 : 0xe74c3c,
              true,
              statusText,
            ),
          ],
          components: [],
        })
        .catch(() => null);

      logToAudit(interaction.client, {
        userId,
        bet: currentBet,
        amount: totalPayout - currentPot,
        oldBalance: initialBalance,
        newBalance: finalUser.gold,
        reason: `Blackjack Result`,
      }).catch(() => null);
    });
  },
};
