const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const User = require("../models/User");

const activePoker = new Map();
const MAX_BET = 500;
const SESSION_EXPIRY = 60000;

/* -------------------- HAND EVALUATOR -------------------- */

const P5 = Math.pow(15, 5);
const P4 = Math.pow(15, 4);
const P3 = Math.pow(15, 3);
const P2 = Math.pow(15, 2);
const P1 = Math.pow(15, 1);
const P0 = 1;

const getKickerScore = (ranks) =>
  (ranks[0] || 0) * P4 +
  (ranks[1] || 0) * P3 +
  (ranks[2] || 0) * P2 +
  (ranks[3] || 0) * P1 +
  (ranks[4] || 0) * P0;

const getStraightHigh = (cards) => {
  const unique = [...new Set(cards.map((c) => c.rank))].sort((a, b) => b - a);

  for (let i = 0; i <= unique.length - 5; i++) {
    if (unique[i] - unique[i + 4] === 4) return unique[i];
  }

  if ([12, 0, 1, 2, 3].every((r) => unique.includes(r))) return 3;
  return -1;
};

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
      const sfHigh = getStraightHigh(flushCards);

      if (sfHigh !== -1) {
        const score = 8 * P5 + sfHigh * P4;
        if (!bestFlush || score > bestFlush.score)
          bestFlush = { score, label: "Straight Flush" };
      } else {
        const score = 5 * P5 + getKickerScore(flushCards.map((c) => c.rank));
        if (!bestFlush || score > bestFlush.score)
          bestFlush = { score, label: "Flush" };
      }
    }
  }

  const counts = {};
  sorted.forEach((c) => (counts[c.val] = (counts[c.val] || 0) + 1));

  const countArr = Object.entries(counts)
    .map(([v, count]) => ({
      val: v,
      count,
      rank: order.indexOf(v),
    }))
    .sort((a, b) =>
      b.count !== a.count ? b.count - a.count : b.rank - a.rank,
    );

  if (bestFlush?.label === "Straight Flush") return bestFlush;

  if (countArr[0].count === 4) {
    const kicker = sorted.find((c) => c.val !== countArr[0].val).rank;
    return {
      score: 7 * P5 + countArr[0].rank * P4 + kicker * P3,
      label: "Four of a Kind",
    };
  }

  const triples = countArr.filter((c) => c.count >= 3);
  const pairs = countArr.filter((c) => c.count >= 2);

  if (triples.length && pairs.length >= 2) {
    const t = triples[0];
    const p = pairs.find((x) => x.val !== t.val);
    return {
      score: 6 * P5 + t.rank * P4 + p.rank * P3,
      label: "Full House",
    };
  }

  if (bestFlush) return bestFlush;

  const straightHigh = getStraightHigh(sorted);
  if (straightHigh !== -1)
    return { score: 4 * P5 + straightHigh * P4, label: "Straight" };

  if (countArr[0].count === 3) {
    const kickers = sorted
      .filter((c) => c.val !== countArr[0].val)
      .map((c) => c.rank);

    return {
      score: 3 * P5 + countArr[0].rank * P4 + getKickerScore(kickers),
      label: "Three of a Kind",
    };
  }

  const twoPairs = pairs.filter((c) => c.count === 2);

  if (twoPairs.length >= 2) {
    const kicker = sorted.find(
      (c) => c.val !== twoPairs[0].val && c.val !== twoPairs[1].val,
    ).rank;

    return {
      score:
        2 * P5 + twoPairs[0].rank * P4 + twoPairs[1].rank * P3 + kicker * P2,
      label: "Two Pair",
    };
  }

  if (twoPairs.length === 1) {
    const kickers = sorted
      .filter((c) => c.val !== twoPairs[0].val)
      .map((c) => c.rank);

    return {
      score: 1 * P5 + twoPairs[0].rank * P4 + getKickerScore(kickers),
      label: "Pair",
    };
  }

  return {
    score: getKickerScore(sorted.map((c) => c.rank)),
    label: "High Card",
  };
};

/* -------------------- 6-DECK SHOE -------------------- */

const getShoe = (count = 6) => {
  const suits = ["S", "H", "C", "D"];
  const suitEmojis = { S: "♠️", H: "❤️", C: "♣️", D: "♦️" };
  const values = "23456789TJQKA".split("");

  let shoe = [];

  for (let i = 0; i < count; i++) {
    for (const s of suits) {
      for (const v of values) {
        shoe.push({ id: `${v}${suitEmojis[s]}`, val: v, suit: s });
      }
    }
  }

  for (let i = shoe.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
  }

  return shoe;
};

/* -------------------- COMMAND -------------------- */

module.exports = {
  name: "poker",

  async execute(interaction) {
    const { user, options } = interaction;
    const bet = options.getInteger("amount");

    const now = Date.now();
    for (const [id, ts] of activePoker)
      if (now - ts > SESSION_EXPIRY) activePoker.delete(id);

    if (activePoker.has(user.id))
      return interaction.reply({
        content: "❌ Finish your current game first!",
        ephemeral: true,
      });

    if (!bet || bet < 25 || bet > MAX_BET)
      return interaction.reply({
        content: `❌ Bet must be 25–${MAX_BET}`,
        ephemeral: true,
      });

    const userData = await User.findOne({ userId: user.id });

    if (!userData || userData.gold < bet)
      return interaction.reply({
        content: "❌ Not enough gold!",
        ephemeral: true,
      });

    activePoker.set(user.id, now);

    await User.updateOne({ userId: user.id }, { $inc: { gold: -bet } });

    const deck = getShoe();

    let player = [deck.pop(), deck.pop()];
    let bot = [deck.pop(), deck.pop()];
    let board = [deck.pop(), deck.pop(), deck.pop()];

    const makeEmbed = (status, reveal = false, color = 0x5865f2) =>
      new EmbedBuilder()
        .setTitle("🃏 Texas Hold'em")
        .setColor(color)
        .setDescription(status)
        .addFields(
          {
            name: "👤 You",
            value: player.map((c) => c.id).join(" "),
            inline: true,
          },
          {
            name: "🤖 Bot",
            value: reveal ? bot.map((c) => c.id).join(" ") : "❓ ❓",
            inline: true,
          },
          { name: "🎴 Board", value: board.map((c) => c.id).join(" ") },
        );

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

    const msg = await interaction.reply({
      embeds: [makeEmbed("Flop dealt — Call or Fold?")],
      components: [row],
      fetchReply: true,
    });

    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 45000,
    });

    collector.on("collect", async (i) => {
      if (i.user.id !== user.id)
        return i.reply({ content: "Not your game!", ephemeral: true });

      collector.stop();

      if (i.customId === "fold") {
        activePoker.delete(user.id);
        return i.update({
          embeds: [makeEmbed("🏳️ You folded", true, 0xe74c3c)],
          components: [],
        });
      }

      board.push(deck.pop(), deck.pop());

      const p = evaluateHand([...player, ...board]);
      const b = evaluateHand([...bot, ...board]);

      const win = p.score > b.score;
      const push = p.score === b.score;
      const payout = win ? bet * 2 : push ? bet : 0;

      const updated = await User.findOneAndUpdate(
        { userId: user.id },
        { $inc: { gold: payout } },
        { new: true },
      );

      activePoker.delete(user.id);

      const result = win
        ? `✅ Win — ${p.label}`
        : push
          ? "🤝 Push"
          : `❌ Loss — Bot: ${b.label}`;

      await i.update({
        embeds: [
          makeEmbed(result, true, win ? 0x2ecc71 : push ? 0xf1c40f : 0xe74c3c),
        ],
        components: [],
      });
    });

    collector.on("end", async (_, reason) => {
      if (reason === "time") {
        activePoker.delete(user.id);
        board.push(deck.pop(), deck.pop());

        await interaction.editReply({
          embeds: [makeEmbed("⏱️ Timed out — folded", true, 0x34495e)],
          components: [],
        });
      }
    });
  },
};
