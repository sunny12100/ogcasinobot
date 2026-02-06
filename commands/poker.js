const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const User = require("../models/User");
const { logToAudit } = require("../utils/logger");

const activePoker = new Map();
const MAX_BET = 500;
const SESSION_EXPIRY = 60000;

/* -------------------- MATHEMATICAL SLOTS -------------------- */
const P5 = Math.pow(15, 5);
const P4 = Math.pow(15, 4);
const P3 = Math.pow(15, 3);
const P2 = Math.pow(15, 2);
const P1 = Math.pow(15, 1);
const P0 = 1;

const getShoe = (deckCount = 6) => {
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
  let shoe = [];
  for (let i = 0; i < deckCount; i++) {
    for (const s of suits) {
      for (const v of values)
        shoe.push({ id: `**${v}${suitEmojis[s]}**`, val: v, suit: s });
    }
  }
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
  }
  return shoe;
};

/* --- Evaluator stays same (Mathematically Correct) --- */
const getKickerScore = (ranks) =>
  (ranks[0] || 0) * P4 +
  (ranks[1] || 0) * P3 +
  (ranks[2] || 0) * P2 +
  (ranks[3] || 0) * P1 +
  (ranks[4] || 0) * P0;

const evaluateHand = (cards) => {
  const order = "23456789TJQKA";
  const sorted = cards
    .map((c) => ({ ...c, rank: order.indexOf(c.val) }))
    .sort((a, b) => b.rank - a.rank);
  const suits = { S: [], H: [], C: [], D: [] };
  sorted.forEach((c) => suits[c.suit].push(c));
  let bestFlush = null;
  for (const s in suits) {
    if (suits[s].length >= 5) {
      const flushCards = suits[s].sort((a, b) => b.rank - a.rank);
      const sFlushHigh = getStraightHigh(flushCards);
      if (sFlushHigh !== -1) {
        const sfScore = 8 * P5 + sFlushHigh * P4;
        if (!bestFlush || sfScore > bestFlush.score)
          bestFlush = { score: sfScore, label: "Straight Flush" };
        if (sFlushHigh === 12) return bestFlush;
      } else {
        const fScore = 5 * P5 + getKickerScore(flushCards.map((c) => c.rank));
        if (!bestFlush || fScore > bestFlush.score)
          bestFlush = { score: fScore, label: "Flush" };
      }
    }
  }
  if (bestFlush && bestFlush.label === "Straight Flush") return bestFlush;
  const counts = {};
  sorted.forEach((c) => (counts[c.val] = (counts[c.val] || 0) + 1));
  const countArr = Object.entries(counts)
    .map(([v, count]) => ({ val: v, count, rank: order.indexOf(v) }))
    .sort((a, b) =>
      b.count !== a.count ? b.count - a.count : b.rank - a.rank,
    );
  if (countArr[0].count === 4)
    return {
      score:
        7 * P5 +
        countArr[0].rank * P4 +
        sorted.find((c) => c.val !== countArr[0].val).rank * P3,
      label: "Four of a Kind",
    };
  const triples = countArr.filter((c) => c.count >= 3);
  const pairsOrTrips = countArr.filter((c) => c.count >= 2);
  if (triples.length >= 1 && pairsOrTrips.length >= 2) {
    const mainTriple = triples[0];
    const pair = pairsOrTrips
      .filter((c) => c.val !== mainTriple.val)
      .sort((a, b) => b.rank - a.rank)[0];
    return {
      score: 6 * P5 + mainTriple.rank * P4 + pair.rank * P3,
      label: "Full House",
    };
  }
  if (bestFlush) return bestFlush;
  const sHigh = getStraightHigh(sorted);
  if (sHigh !== -1) return { score: 4 * P5 + sHigh * P4, label: "Straight" };
  if (countArr[0].count === 3)
    return {
      score:
        3 * P5 +
        countArr[0].rank * P4 +
        getKickerScore(
          sorted.filter((c) => c.val !== countArr[0].val).map((c) => c.rank),
        ),
      label: "Three of a Kind",
    };
  const pairs = countArr
    .filter((c) => c.count === 2)
    .sort((a, b) => b.rank - a.rank);
  if (pairs.length >= 2)
    return {
      score:
        2 * P5 +
        pairs[0].rank * P4 +
        pairs[1].rank * P3 +
        sorted.filter(
          (c) => c.val !== pairs[0].val && c.val !== pairs[1].val,
        )[0].rank *
          P2,
      label: "Two Pair",
    };
  if (pairs.length === 1)
    return {
      score:
        1 * P5 +
        pairs[0].rank * P4 +
        getKickerScore(
          sorted.filter((c) => c.val !== pairs[0].val).map((c) => c.rank),
        ),
      label: "Pair",
    };
  return {
    score: getKickerScore(sorted.map((c) => c.rank)),
    label: "High Card",
  };
};

const getStraightHigh = (cards) => {
  const uniqueRanks = [...new Set(cards.map((c) => c.rank))].sort(
    (a, b) => b - a,
  );
  for (let i = 0; i <= uniqueRanks.length - 5; i++)
    if (uniqueRanks[i] - uniqueRanks[i + 4] === 4) return uniqueRanks[i];
  if ([12, 0, 1, 2, 3].every((r) => uniqueRanks.includes(r))) return 3;
  return -1;
};

/* -------------------- COMMAND -------------------- */
module.exports = {
  name: "poker",
  async execute(interaction) {
    const { user, options, client } = interaction;
    const currentBet = options.getInteger("amount");

    const now = Date.now();
    for (const [id, ts] of activePoker)
      if (now - ts > SESSION_EXPIRY) activePoker.delete(id);

    if (!currentBet || currentBet < 25 || currentBet > MAX_BET)
      return interaction.reply({
        content: `❌ Bet 25-${MAX_BET} gold!`,
        ephemeral: true,
      });
    if (activePoker.has(user.id))
      return interaction.reply({
        content: "❌ Finish current game!",
        ephemeral: true,
      });

    await interaction.deferReply();
    let userData = await User.findOne({ userId: user.id });
    if (!userData || userData.gold < currentBet)
      return interaction.editReply("❌ Not enough gold!");

    activePoker.set(user.id, now);
    await User.updateOne({ userId: user.id }, { $inc: { gold: -currentBet } });

    const deck = getShoe(6);
    let playerHand = [deck.pop(), deck.pop()];
    let botHand = [deck.pop(), deck.pop()];
    let community = [deck.pop(), deck.pop(), deck.pop()];

    const createEmbed = (status, resultData = null, color = 0x5865f2) => {
      const embed = new EmbedBuilder()
        .setTitle("🃏 Casino Texas Hold'em")
        .setColor(color)
        .setDescription(`## ${status}\n${"▬".repeat(22)}`)
        .addFields(
          {
            name: "👤 YOUR HAND",
            value: playerHand.map((c) => c.id).join(" "),
            inline: true,
          },
          {
            name: "🤖 HOUSE HAND",
            value: resultData ? botHand.map((c) => c.id).join(" ") : "❓ ❓",
            inline: true,
          },
          {
            name: "🎴 THE BOARD",
            value: community.map((c) => c.id).join(" "),
            inline: false,
          },
        );

      if (resultData) {
        const profitText =
          resultData.net > 0
            ? `+${resultData.net} (Winner!)`
            : resultData.net < 0
              ? `${resultData.net} (Loss)`
              : `0 (Push)`;
        embed.addFields({
          name: "💰 FINAL SETTLEMENT",
          value: `\`\`\`diff\n- Initial Bet: ${currentBet}\n+ Payout Received: ${resultData.payout}\n${resultData.net >= 0 ? "+" : "-"} Profit/Loss: ${profitText}\n\`\`\``,
          inline: false,
        });
      }

      const currentBalance = resultData
        ? resultData.balance
        : userData.gold - currentBet;
      embed.setFooter({
        text: `💵 Balance: ${currentBalance} | Shoe: ${deck.length} cards left`,
      });
      return embed;
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
      embeds: [createEmbed("Flop dealt. Call to see the turn and river.")],
      components: [row],
    });
    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 45000,
    });

    collector.on("collect", async (i) => {
      if (i.user.id !== user.id)
        return i.reply({ content: "Not yours!", ephemeral: true });
      collector.stop("processed");

      if (i.customId === "p_fold") {
        activePoker.delete(user.id);
        return i.update({
          embeds: [
            createEmbed(
              "🏳️ YOU FOLDED",
              {
                outcome: "Folded",
                payout: 0,
                net: -currentBet,
                balance: userData.gold - currentBet,
              },
              0xe74c3c,
            ),
          ],
          components: [],
        });
      }

      community.push(deck.pop(), deck.pop());
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

      const resultData = {
        outcome: playerWins
          ? "✅ YOU WON"
          : isPush
            ? "🤝 PUSH"
            : "❌ HOUSE WON",
        payout: payout,
        net: payout - currentBet,
        balance: finalUser.gold,
        hand: playerWins ? pRes.label : bRes.label,
      };

      await i.update({
        embeds: [
          createEmbed(
            `${resultData.outcome} with ${playerWins ? pRes.label : bRes.label}`,
            resultData,
            playerWins ? 0x2ecc71 : isPush ? 0xf1c40f : 0xe74c3c,
          ),
        ],
        components: [],
      });

      logToAudit(client, {
        userId: user.id,
        bet: currentBet,
        amount: resultData.net,
        oldBalance: userData.gold - currentBet,
        newBalance: finalUser.gold,
        reason: `Poker: ${pRes.label} vs ${bRes.label}`,
      });
    });

    collector.on("end", async (_, reason) => {
      if (reason === "time") {
        activePoker.delete(user.id);
        community.push(deck.pop(), deck.pop());
        const afkUser = await User.findOne({ userId: user.id });
        await interaction.editReply({
          embeds: [
            createEmbed(
              "⏱️ TIMEOUT (Fold)",
              {
                outcome: "AFK",
                payout: 0,
                net: -currentBet,
                balance: afkUser.gold,
              },
              0x34495e,
            ),
          ],
          components: [],
        });
      }
    });
  },
};
