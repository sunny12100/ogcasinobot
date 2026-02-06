const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const User = require("../models/User");
const { logToAudit } = require("../utils/logger");

const activePoker = new Set();
const MAX_BET = 500;

/* -------------------- PERSISTENT DECK -------------------- */
let globalPokerDeck = [];

const shuffleShoe = () => {
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
    "T",
    "J",
    "Q",
    "K",
    "A",
  ];
  let newDeck = [];
  // Standard 52-card deck
  for (const s of suits) {
    for (const v of values) newDeck.push(`${v}${s}`);
  }
  newDeck.sort(() => Math.random() - 0.5);
  globalPokerDeck = newDeck;
};

// Initial shuffle
shuffleShoe();

/* -------------------- HAND EVALUATOR (FIXED) -------------------- */
const evaluateHand = (hand, community) => {
  const allCards = [...hand, ...community];
  const order = "23456789TJQKA";

  const cardObjects = allCards
    .map((c) => ({
      val: c.slice(0, -2),
      suit: c.slice(-2),
      rank: order.indexOf(c.slice(0, -2)),
    }))
    .sort((a, b) => b.rank - a.rank);

  const counts = {};
  cardObjects.forEach((c) => (counts[c.val] = (counts[c.val] || 0) + 1));
  const countValues = Object.values(counts);

  // Correct Flush Check
  const suitsInHand = cardObjects.map((c) => c.suit);
  const isFlush = ["♠️", "❤️", "♣️", "♦️"].some(
    (s) => suitsInHand.filter((suit) => suit === s).length >= 5,
  );

  // Correct Straight Check (Including Ace-Low Wheel)
  let uniqueRanks = [...new Set(cardObjects.map((c) => c.rank))].sort(
    (a, b) => b - a,
  );
  let straightHigh = -1;

  for (let i = 0; i <= uniqueRanks.length - 5; i++) {
    if (uniqueRanks[i] - uniqueRanks[i + 4] === 4) {
      straightHigh = uniqueRanks[i];
      break;
    }
  }
  // FIX: Ace-2-3-4-5 Straight
  if (
    straightHigh === -1 &&
    [12, 0, 1, 2, 3].every((r) => uniqueRanks.includes(r))
  ) {
    straightHigh = 3;
  }

  /* --- Hierarchy --- */
  if (straightHigh !== -1 && isFlush)
    return { score: 8000 + straightHigh, label: "Straight Flush" };
  if (countValues.includes(4)) return { score: 7000, label: "Four of a Kind" };
  if (countValues.includes(3) && countValues.includes(2))
    return { score: 6000, label: "Full House" };
  if (isFlush) return { score: 5000, label: "Flush" };
  if (straightHigh !== -1)
    return { score: 4000 + straightHigh, label: "Straight" };
  if (countValues.includes(3)) return { score: 3000, label: "Three of a Kind" };
  if (countValues.filter((v) => v === 2).length >= 2)
    return { score: 2000, label: "Two Pair" };
  if (countValues.includes(2)) return { score: 1000, label: "Pair" };
  return { score: cardObjects[0].rank, label: "High Card" };
};

/* -------------------- COMMAND -------------------- */
module.exports = {
  name: "poker",
  async execute(interaction) {
    const userId = interaction.user.id;
    const currentBet = interaction.options.getInteger("amount");

    // Increased buffer to 20 to ensure enough cards for a full hand + rigging draws
    if (globalPokerDeck.length < 20) shuffleShoe();

    if (currentBet > MAX_BET) {
      return interaction.reply({
        content: `❌ Max bet is ${MAX_BET}!`,
        ephemeral: true,
      });
    }
    if (activePoker.has(userId)) {
      return interaction.reply({
        content: "❌ Finish your current game!",
        ephemeral: true,
      });
    }

    await interaction.deferReply();
    const userData = await User.findOne({ userId });
    if (!userData || userData.gold < currentBet) {
      return interaction.editReply("❌ Not enough gold!");
    }

    activePoker.add(userId);
    const initialBalance = userData.gold;
    await User.updateOne({ userId }, { $inc: { gold: -currentBet } });

    let playerHand = [globalPokerDeck.pop(), globalPokerDeck.pop()];
    let botHand = [globalPokerDeck.pop(), globalPokerDeck.pop()];
    let community = [
      globalPokerDeck.pop(),
      globalPokerDeck.pop(),
      globalPokerDeck.pop(),
    ];

    const createEmbed = (status, showBot = false, color = 0x5865f2) => {
      return new EmbedBuilder()
        .setTitle("🃏 Texas Hold'em vs Bot")
        .setColor(color)
        .setDescription(`**GAME STATUS**\n> ${status}\n${"▬".repeat(25)}`)
        .addFields(
          {
            name: "👤 YOUR HAND",
            value: `**${playerHand.join(" ")}**`,
            inline: true,
          },
          {
            name: "🤖 BOT HAND",
            value: showBot ? `**${botHand.join(" ")}**` : "❓ ❓",
            inline: true,
          },
          {
            name: "🎴 COMMUNITY BOARD",
            value: community.join(" "),
            inline: false,
          },
        )
        .setFooter({
          text: `💰 Pot: ${currentBet * 2} | Shoe: ${globalPokerDeck.length} cards left`,
        });
    };

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("call")
        .setLabel("Call")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("fold")
        .setLabel("Fold")
        .setStyle(ButtonStyle.Danger),
    );

    const msg = await interaction.editReply({
      embeds: [createEmbed("The Flop is out. Will you Call or Fold?")],
      components: [row],
    });

    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 45000,
    });

    collector.on("collect", async (i) => {
      if (i.user.id !== userId)
        return i.reply({ content: "Not your game!", ephemeral: true });

      if (i.customId === "fold") {
        collector.stop("folded");
        return i.update({
          embeds: [
            createEmbed("🏳️ You folded. Bot takes the pot.", true, 0xe74c3c),
          ],
          components: [],
        });
      }

      /* --- THE CALL / SHOWDOWN WITH RIGGING --- */
      // 1. Deal Turn
      community.push(globalPokerDeck.pop());

      // 2. Determine if we should rig the River (40% chance if player is winning)
      const currentP = evaluateHand(playerHand, community);
      const currentB = evaluateHand(botHand, community);

      let riverCard;
      if (currentP.score > currentB.score && Math.random() < 0.4) {
        // Find a card in the remaining deck that gives the bot a better score than the player
        const saviorCardIndex = globalPokerDeck.findIndex((card) => {
          const testCommunity = [...community, card];
          return (
            evaluateHand(botHand, testCommunity).score >
            evaluateHand(playerHand, testCommunity).score
          );
        });

        if (saviorCardIndex !== -1) {
          riverCard = globalPokerDeck.splice(saviorCardIndex, 1)[0];
        } else {
          riverCard = globalPokerDeck.pop();
        }
      } else {
        riverCard = globalPokerDeck.pop();
      }

      community.push(riverCard);

      const pRes = evaluateHand(playerHand, community);
      const bRes = evaluateHand(botHand, community);

      const playerWins = pRes.score > bRes.score;
      const isPush = pRes.score === bRes.score;
      const payout = playerWins ? currentBet * 2 : isPush ? currentBet : 0;

      const finalUser = await User.findOneAndUpdate(
        { userId },
        { $inc: { gold: payout } },
        { new: true },
      );

      const resultText = playerWins
        ? `✅ **YOU WIN!**\nYour Hand: **${pRes.label}**\nBot Hand: ${bRes.label}`
        : isPush
          ? `🤝 **PUSH**\nBoth had: ${pRes.label}`
          : `❌ **BOT WINS**\nBot Hand: **${bRes.label}**\nYour Hand: ${pRes.label}`;

      await i.update({
        embeds: [
          createEmbed(resultText, true, playerWins ? 0x2ecc71 : 0xe74c3c),
        ],
        components: [],
      });

      logToAudit(interaction.client, {
        userId,
        bet: currentBet,
        amount: payout - currentBet,
        oldBalance: initialBalance,
        newBalance: finalUser.gold,
        reason: `Poker Showdown: ${pRes.label} vs ${bRes.label}`,
      }).catch(() => null);

      collector.stop("ended");
    });

    collector.on("end", async (_, reason) => {
      activePoker.delete(userId);
      if (reason === "time") {
        await interaction
          .editReply({
            embeds: [
              createEmbed(
                "⏱️ **AFK - Auto Folded**\nYou took too long to act.",
                true,
                0x34495e,
              ),
            ],
            components: [],
          })
          .catch(() => null);

        logToAudit(interaction.client, {
          userId,
          bet: currentBet,
          amount: -currentBet,
          oldBalance: initialBalance,
          newBalance: initialBalance - currentBet,
          reason: "Poker Result: AFK Fold",
        }).catch(() => null);
      }
    });
  },
};
