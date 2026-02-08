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
    // Handle both Slash Commands and prefix commands if necessary
    const currentBet = interaction.options?.getInteger("amount") || 200;

    // 1. PREVENT MULTIPLE GAMES
    if (activeBlackjack.has(userId)) {
      return interaction.reply({
        content: "❌ Game already in progress! Finish it first.",
        ephemeral: true,
      });
    }

    if (currentBet > MAX_BET || currentBet < 50) {
      return interaction.reply({
        content: `❌ Bets must be between 50 and ${MAX_BET} gold!`,
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    // 2. CHECK & DEDUCT BALANCE
    const userData = await User.findOne({ userId });
    if (!userData || userData.gold < currentBet) {
      return interaction.editReply({ content: "❌ Not enough gold!" });
    }

    activeBlackjack.add(userId);
    const initialBalance = userData.gold;
    await User.updateOne({ userId }, { $inc: { gold: -currentBet } });

    /* -------------------- FRESH DECK PER GAME -------------------- */
    // Moving deck inside execute stops card-counting exploits.
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
      // Use 6 decks to maintain standard casino house edge
      for (let i = 0; i < 6; i++) {
        for (const s of suits) {
          for (const v of values) newDeck.push(`${v}${s}`);
        }
      }
      return newDeck.sort(() => Math.random() - 0.5);
    };

    let deck = generateDeck();
    let playerHand = [deck.pop(), deck.pop()];
    let dealerHand = [deck.pop(), deck.pop()];
    let currentPot = currentBet;
    let isSplit = false;
    let splitHands = [];
    let activeHandIndex = 0;
    let isProcessing = false;

    const getVal = (hand) => {
      let total = 0;
      let aces = 0;
      for (const card of hand) {
        const v = card.replace(/[♠️❤️♣️♦️]/g, "");
        if (v === "A") {
          aces++;
          total += 1;
        } else if (["J", "Q", "K"].includes(v)) total += 10;
        else total += parseInt(v);
      }
      while (aces > 0 && total + 10 <= 21) {
        total += 10;
        aces--;
      }
      return total;
    };

    const cardVal = (card) => card.replace(/[♠️❤️♣️♦️]/g, "").trim();

    const createEmbed = (
      title,
      color,
      showDealer = false,
      status = "Your move!",
    ) => {
      return new EmbedBuilder()
        .setTitle(title)
        .setColor(color)
        .setDescription(`**GAME STATUS**\n> ${status}\n${"▬".repeat(25)}`)
        .addFields(
          {
            name: "👤 PLAYER",
            value: `**${playerHand.join(" ")}**\nValue: ${getVal(playerHand)}`,
            inline: true,
          },
          {
            name: "🏦 DEALER",
            value: showDealer
              ? `**${dealerHand.join(" ")}**\nValue: ${getVal(dealerHand)}`
              : `**${dealerHand[0]}** ??`,
            inline: true,
          },
        )
        .setFooter({
          text: `💰 Bet: ${currentPot} | Total Cards: ${deck.length}`,
        });
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
      const canSplit =
        playerHand.length === 2 &&
        cardVal(playerHand[0]) === cardVal(playerHand[1]) &&
        !isSplit &&
        freshUser.gold >= currentBet;

      if (canSplit) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId("split")
            .setLabel("Split")
            .setStyle(ButtonStyle.Success),
        );
      }
      return row;
    };

    /* -------------------- INITIAL BLACKJACK CHECK -------------------- */
    if (getVal(playerHand) === 21) {
      activeBlackjack.delete(userId);
      const dVal = getVal(dealerHand);
      // Payout 3:2 for Blackjack (2.5x total) or push if dealer also has 21
      const payout = dVal === 21 ? currentPot : Math.floor(currentPot * 2.5);
      const finalUser = await User.findOneAndUpdate(
        { userId },
        { $inc: { gold: payout } },
        { new: true },
      );

      return interaction.editReply({
        embeds: [
          createEmbed(
            "🎉 BLACKJACK!",
            0x2ecc71,
            true,
            dVal === 21 ? "🤝 **PUSH (Both 21)**" : "💰 **WINNER!**",
          ),
        ],
        components: [],
      });
    }

    const msg = await interaction.editReply({
      embeds: [createEmbed("🃏 BLACKJACK", 0x5865f2)],
      components: [await buildButtons()],
    });

    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 45000,
    });

    collector.on("collect", async (i) => {
      if (i.user.id !== userId)
        return i.reply({ content: "Not your game!", ephemeral: true });
      if (isProcessing) return;
      isProcessing = true;

      if (i.customId === "hit") {
        playerHand.push(deck.pop());
        if (getVal(playerHand) >= 21) {
          if (isSplit && activeHandIndex === 0) {
            activeHandIndex = 1;
            playerHand = splitHands[1];
            await i.update({
              embeds: [createEmbed("🃏 SPLIT: Hand 2", 0x5865f2)],
              components: [await buildButtons()],
            });
          } else {
            collector.stop("ended");
            await i.deferUpdate().catch(() => null);
          }
        } else {
          await i.update({
            embeds: [
              createEmbed(
                isSplit
                  ? `🃏 SPLIT: Hand ${activeHandIndex + 1}`
                  : "🃏 BLACKJACK",
                0x5865f2,
              ),
            ],
            components: [await buildButtons()],
          });
        }
      } else if (i.customId === "split") {
        await User.updateOne({ userId }, { $inc: { gold: -currentBet } });
        currentPot += currentBet;
        isSplit = true;
        splitHands = [
          [playerHand[0], deck.pop()],
          [playerHand[1], deck.pop()],
        ];
        playerHand = splitHands[0];
        activeHandIndex = 0;
        await i.update({
          embeds: [createEmbed("🃏 SPLIT: Hand 1", 0x5865f2)],
          components: [await buildButtons()],
        });
      } else if (i.customId === "stand") {
        if (isSplit && activeHandIndex === 0) {
          activeHandIndex = 1;
          playerHand = splitHands[1];
          await i.update({
            embeds: [createEmbed("🃏 SPLIT: Hand 2", 0x5865f2)],
            components: [await buildButtons()],
          });
        } else {
          collector.stop("ended");
          await i.deferUpdate().catch(() => null);
        }
      }
      isProcessing = false;
    });

    collector.on("end", async (_, reason) => {
      activeBlackjack.delete(userId);
      let dVal = getVal(dealerHand);
      const pHands = isSplit ? splitHands : [playerHand];

      // Dealer only plays if player hasn't busted all hands
      if (pHands.some((h) => getVal(h) <= 21)) {
        while (dVal < 17) {
          dealerHand.push(deck.pop());
          dVal = getVal(dealerHand);
        }
      }

      let totalPayout = 0;
      let handResults = [];
      for (let idx = 0; idx < pHands.length; idx++) {
        const pVal = getVal(pHands[idx]);
        const label = isSplit ? `Hand ${idx + 1}` : "Game";
        if (pVal > 21) {
          handResults.push(`${label}: 💀 BUST`);
        } else if (dVal > 21 || pVal > dVal) {
          totalPayout += currentBet * 2;
          handResults.push(`${label}: ✅ WIN`);
        } else if (pVal === dVal) {
          totalPayout += currentBet;
          handResults.push(`${label}: 🤝 PUSH`);
        } else {
          handResults.push(`${label}: ❌ LOSE`);
        }
      }

      const finalUser = await User.findOneAndUpdate(
        { userId },
        { $inc: { gold: totalPayout } },
        { new: true },
      );

      await interaction
        .editReply({
          embeds: [
            createEmbed(
              totalPayout > currentPot ? "🎉 WINNER" : "💀 RESULT",
              totalPayout > currentPot ? 0x2ecc71 : 0xe74c3c,
              true,
              handResults.join("\n"),
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
        reason: `Blackjack: ${isSplit ? "Split" : "Standard"}`,
      });
    });
  },
};
