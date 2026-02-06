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

/* -------------------- UTILS -------------------- */
const getFisherYatesDeck = () => {
  const suits = ["S", "H", "C", "D"];
  const suitEmojis = { S: "♠️", H: "❤️", C: "♣️", D: "♦️" };
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
  let deck = [];
  for (const s of suits) {
    for (const v of values)
      deck.push({ id: `${v}${suitEmojis[s]}`, val: v, suit: s });
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
};

/* -------------------- TIE-BREAKER SCORING (BASE 15) -------------------- */
// This encodes 5 cards into a unique number.
// Rank 1 is highest card, Rank 5 is lowest.
const getKickerScore = (ranks) => {
  return ranks
    .slice(0, 5)
    .reduce((acc, rank, i) => acc + rank * Math.pow(15, 4 - i), 0);
};

/* -------------------- THE FINAL EVALUATOR -------------------- */
const evaluateHand = (cards) => {
  const order = "23456789TJQKA";
  const sorted = cards
    .map((c) => ({ ...c, rank: order.indexOf(c.val) }))
    .sort((a, b) => b.rank - a.rank);

  // 1. Check Flush & Straight Flush
  const suits = { S: [], H: [], C: [], D: [] };
  sorted.forEach((c) => suits[c.suit].push(c));

  let flushResult = null;
  for (const s in suits) {
    if (suits[s].length >= 5) {
      const flushCards = suits[s].sort((a, b) => b.rank - a.rank);
      const sFlushHigh = getStraightHigh(flushCards);
      if (sFlushHigh !== -1)
        return { score: 8000000 + sFlushHigh, label: "Straight Flush" };

      // Compare multiple flushes (rare) or save best flush kickers
      const currentFlushScore =
        5000000 + getKickerScore(flushCards.map((c) => c.rank));
      if (!flushResult || currentFlushScore > flushResult.score) {
        flushResult = { score: currentFlushScore, label: "Flush" };
      }
    }
  }

  const counts = {};
  sorted.forEach((c) => (counts[c.val] = (counts[c.val] || 0) + 1));
  const countArr = Object.entries(counts)
    .map(([v, count]) => ({ val: v, count, rank: order.indexOf(v) }))
    .sort((a, b) =>
      b.count !== a.count ? b.count - a.count : b.rank - a.rank,
    );

  // 2. Four of a Kind + Kicker
  if (countArr[0].count === 4) {
    const kicker = sorted.find((c) => c.val !== countArr[0].val).rank;
    return {
      score: 7000000 + countArr[0].rank * 15 + kicker,
      label: "Four of a Kind",
    };
  }

  // 3. Full House (Rank of Triple + Rank of Pair)
  if (countArr[0].count === 3 && countArr[1].count >= 2) {
    return {
      score: 6000000 + countArr[0].rank * 15 + countArr[1].rank,
      label: "Full House",
    };
  }

  // 4. Flush (If found earlier)
  if (flushResult) return flushResult;

  // 5. Straight
  const sHigh = getStraightHigh(sorted);
  if (sHigh !== -1) return { score: 4000000 + sHigh, label: "Straight" };

  // 6. Three of a Kind + 2 Kickers
  if (countArr[0].count === 3) {
    const kickers = sorted
      .filter((c) => c.val !== countArr[0].val)
      .map((c) => c.rank);
    return {
      score:
        3000000 + countArr[0].rank * 225 + getKickerScore(kickers.slice(0, 2)),
      label: "Three of a Kind",
    };
  }

  // 7. Two Pair + 1 Kicker
  if (countArr[0].count === 2 && countArr[1].count === 2) {
    const kicker = sorted.find(
      (c) => c.val !== countArr[0].val && c.val !== countArr[1].val,
    ).rank;
    return {
      score: 2000000 + countArr[0].rank * 225 + countArr[1].rank * 15 + kicker,
      label: "Two Pair",
    };
  }

  // 8. Pair + 3 Kickers
  if (countArr[0].count === 2) {
    const kickers = sorted
      .filter((c) => c.val !== countArr[0].val)
      .map((c) => c.rank);
    return {
      score:
        1000000 +
        countArr[0].rank * Math.pow(15, 3) +
        getKickerScore(kickers.slice(0, 3)),
      label: "Pair",
    };
  }

  // 9. High Card (All 5 cards encoded)
  return {
    score: getKickerScore(sorted.map((c) => c.rank)),
    label: "High Card",
  };
};

const getStraightHigh = (cards) => {
  const uniqueRanks = [...new Set(cards.map((c) => c.rank))].sort(
    (a, b) => b - a,
  );
  for (let i = 0; i <= uniqueRanks.length - 5; i++) {
    if (uniqueRanks[i] - uniqueRanks[i + 4] === 4) return uniqueRanks[i];
  }
  if ([12, 0, 1, 2, 3].every((r) => uniqueRanks.includes(r))) return 3;
  return -1;
};

/* -------------------- COMMAND -------------------- */
module.exports = {
  name: "poker",
  async execute(interaction) {
    const { user, options, client } = interaction;
    const currentBet = options.getInteger("amount");

    if (!currentBet || currentBet < 25 || currentBet > MAX_BET) {
      return interaction.reply({
        content: `❌ Bet must be between 25 and ${MAX_BET} gold!`,
        ephemeral: true,
      });
    }

    if (activePoker.has(user.id))
      return interaction.reply({
        content: "❌ You have an active game!",
        ephemeral: true,
      });

    await interaction.deferReply();
    const userData = await User.findOne({ userId: user.id });
    if (!userData || userData.gold < currentBet)
      return interaction.editReply("❌ Not enough gold!");

    activePoker.add(user.id);
    await User.updateOne({ userId: user.id }, { $inc: { gold: -currentBet } });

    const deck = getFisherYatesDeck();
    let playerHand = [deck.pop(), deck.pop()];
    let botHand = [deck.pop(), deck.pop()];
    let community = [deck.pop(), deck.pop(), deck.pop()];

    const createEmbed = (status, showBot = false, color = 0x5865f2) => {
      return new EmbedBuilder()
        .setTitle("🃏 Texas Hold'em vs House")
        .setColor(color)
        .setDescription(`**STATUS**\n> ${status}`)
        .addFields(
          {
            name: "👤 YOUR HAND",
            value: playerHand.map((c) => c.id).join(" "),
            inline: true,
          },
          {
            name: "🤖 BOT HAND",
            value: showBot ? botHand.map((c) => c.id).join(" ") : "❓ ❓",
            inline: true,
          },
          {
            name: "🎴 BOARD",
            value: community.map((c) => c.id).join(" "),
            inline: false,
          },
        )
        .setFooter({
          text: `💰 Pot: ${currentBet * 2} | Player: ${user.username}`,
        });
    };

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("p_call")
        .setLabel("Call")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("p_fold")
        .setLabel("Fold")
        .setStyle(ButtonStyle.Danger),
    );

    const msg = await interaction.editReply({
      embeds: [createEmbed("Call to see Turn & River.")],
      components: [row],
    });

    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 45000,
    });

    collector.on("collect", async (i) => {
      if (i.user.id !== user.id)
        return i.reply({ content: "Not your game!", ephemeral: true });

      collector.stop("processed");

      if (i.customId === "p_fold") {
        activePoker.delete(user.id);
        return i.update({
          embeds: [createEmbed("🏳️ You folded. House wins.", true, 0xe74c3c)],
          components: [],
        });
      }

      community.push(deck.pop()); // Turn
      community.push(deck.pop()); // River

      const pRes = evaluateHand([...playerHand, ...community]);
      const bRes = evaluateHand([...botHand, ...community]);

      const playerWins = pRes.score > bRes.score;
      const isPush = pRes.score === bRes.score;
      const payout = playerWins ? currentBet * 2 : isPush ? currentBet : 0;

      const finalUser = await User.findOneAndUpdate(
        { userId: user.id },
        { $inc: { gold: payout } },
        { new: true },
      );
      activePoker.delete(user.id);

      const resultLabel = playerWins
        ? `✅ **WIN** (${pRes.label})`
        : isPush
          ? `🤝 **PUSH**`
          : `❌ **LOSS** (Bot: ${bRes.label})`;

      await i.update({
        embeds: [
          createEmbed(
            resultLabel,
            true,
            playerWins ? 0x2ecc71 : isPush ? 0xf1c40f : 0xe74c3c,
          ),
        ],
        components: [],
      });

      logToAudit(client, {
        userId: user.id,
        bet: currentBet,
        amount: payout - currentBet,
        oldBalance: userData.gold,
        newBalance: finalUser.gold,
        reason: `Poker: ${pRes.label} vs ${bRes.label}`,
      });
    });

    collector.on("end", async (_, reason) => {
      if (reason === "time") {
        activePoker.delete(user.id);
        const finalData = await User.findOne({ userId: user.id });
        await interaction.editReply({
          embeds: [createEmbed("⏱️ **AFK - Folded**", true, 0x34495e)],
          components: [],
        });
        logToAudit(client, {
          userId: user.id,
          bet: currentBet,
          amount: -currentBet,
          oldBalance: userData.gold,
          newBalance: finalData.gold,
          reason: "Poker: AFK Timeout",
        });
      }
    });
  },
};
