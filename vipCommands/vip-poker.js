const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  SlashCommandBuilder,
} = require("discord.js");
const PassUser = require("../models/PassUser");

const activeGames = new Set();
const order = "23456789TJQKA";

// --- POKER ENGINE ---
const evaluateHand = (cards) => {
  const sorted = cards
    .map((c) => ({ ...c, rank: order.indexOf(c.val) }))
    .sort((a, b) => b.rank - a.rank);
  const counts = {};
  sorted.forEach((c) => (counts[c.val] = (counts[c.val] || 0) + 1));
  const countArr = Object.entries(counts)
    .map(([v, count]) => ({ val: v, count, rank: order.indexOf(v) }))
    .sort((a, b) =>
      b.count !== a.count ? b.count - a.count : b.rank - a.rank,
    );

  const isFlush = ["S", "H", "C", "D"].some(
    (s) => cards.filter((c) => c.suit === s).length >= 5,
  );

  // Scoring Logic: Flush > 3 OAK > Two Pair > Pair > High Card
  if (isFlush) return { score: 500 + countArr[0].rank, label: "Flush" };
  if (countArr[0].count === 3)
    return { score: 300 + countArr[0].rank, label: "3 of a Kind" };
  if (countArr[0].count === 2 && countArr[1]?.count === 2)
    return { score: 200 + countArr[0].rank, label: "Two Pair" };
  if (countArr[0].count === 2)
    return { score: 100 + countArr[0].rank, label: "Pair" };
  return { score: countArr[0].rank, label: "High Card" };
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("vip-poker")
    .setDescription("💎 VIP Lounge: Texas Hold'em (High RTP)")
    .addIntegerOption((opt) =>
      opt
        .setName("amount")
        .setDescription("Gold to bet (1-10,000)")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(10000),
    ),

  async execute(interaction) {
    const { user, member, options } = interaction;
    const amount = options.getInteger("amount");
    const LOUNGE_ROLE = "1483219208962834473";

    if (!member.roles.cache.has(LOUNGE_ROLE)) {
      return interaction.reply({
        content: "🚫 This game is reserved for OG Pass holders!",
        ephemeral: true,
      });
    }

    if (activeGames.has(user.id)) {
      return interaction.reply({
        content: "❌ Finish your current game first!",
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    // 🛡️ BUST PROTECTION / RELOAD LOGIC (50,000 Gold)
    let userData = await PassUser.findOneAndUpdate(
      { userId: user.id, passBalance: { $gte: amount } },
      { $inc: { passBalance: -amount } },
      { new: true },
    );

    if (!userData) {
      userData = await PassUser.findOneAndUpdate(
        { userId: user.id },
        { $set: { passBalance: 50000 } },
        { upsert: true, new: true },
      );
      userData = await PassUser.findOneAndUpdate(
        { userId: user.id },
        { $inc: { passBalance: -amount } },
        { new: true },
      );
    }

    activeGames.add(user.id);

    // Setup Deck & Deal
    const suits = ["S", "H", "C", "D"];
    const emojis = { S: "♠️", H: "❤️", C: "♣️", D: "♦️" };
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
    suits.forEach((s) =>
      values.forEach((v) =>
        deck.push({ id: `${v}${emojis[s]}`, val: v, suit: s }),
      ),
    );
    deck = deck.sort(() => Math.random() - 0.5);

    let playerHand = [deck.pop(), deck.pop()];
    let houseHand = [deck.pop(), deck.pop()];
    let board = [deck.pop(), deck.pop(), deck.pop()];

    const embed = new EmbedBuilder()
      .setTitle("💎 VIP TEXAS HOLD'EM")
      .setColor(0x00ffff)
      .setDescription(
        `### Flop is dealt. Call to see the Turn & River!\n${"▬".repeat(22)}`,
      )
      .addFields(
        {
          name: "👤 YOUR HAND",
          value: `> ${playerHand.map((c) => c.id).join(" ")}`,
          inline: true,
        },
        { name: "🤖 HOUSE", value: "> ❓ ❓", inline: true },
        {
          name: "🎴 THE BOARD",
          value: `\` ${board.map((c) => c.id).join("  ")} \``,
          inline: false,
        },
        { name: "💰 POT", value: `**${amount.toLocaleString()}** Gold (Ante)` },
      )
      .setFooter({ text: `User: ${user.username} | VIP Lounge` });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("v_call")
        .setLabel(`Call (${amount})`)
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("v_fold")
        .setLabel("Fold")
        .setStyle(ButtonStyle.Danger),
    );

    const msg = await interaction.editReply({
      embeds: [embed],
      components: [row],
    });
    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 30000,
    });

    collector.on("collect", async (i) => {
      if (i.user.id !== user.id)
        return i.reply({ content: "Not your game!", ephemeral: true });
      activeGames.delete(user.id);
      collector.stop();

      if (i.customId === "v_fold") {
        await PassUser.updateOne(
          { userId: user.id },
          { $inc: { totalWagered: amount, totalLost: amount } },
        );
        return i.update({
          content: "🏳️ You folded and lost your ante.",
          embeds: [],
          components: [],
        });
      }

      // Check balance for Call (Second bet)
      const checkUser = await PassUser.findOne({ userId: user.id });
      if (checkUser.passBalance < amount)
        return i.reply({
          content: "❌ Not enough gold to Call!",
          ephemeral: true,
        });

      await PassUser.updateOne(
        { userId: user.id },
        { $inc: { passBalance: -amount } },
      );
      board.push(deck.pop(), deck.pop()); // Deal Turn and River

      const pRes = evaluateHand([...playerHand, ...board]);
      const hRes = evaluateHand([...houseHand, ...board]);

      const win = pRes.score > hRes.score;
      const push = pRes.score === hRes.score;
      const totalBet = amount * 2;

      let payout = 0;
      let updateData = { $inc: { totalWagered: totalBet } };

      if (win) {
        payout = Math.floor(amount * 3.5); // VIP Reward: 3.5x payout
        updateData.$inc.passBalance = payout;
        updateData.$inc.totalWon = payout - totalBet;
      } else if (push) {
        payout = totalBet;
        updateData.$inc.passBalance = payout;
      } else {
        updateData.$inc.totalLost = totalBet;
      }

      const finalUser = await PassUser.findOneAndUpdate(
        { userId: user.id },
        updateData,
        { new: true },
      );

      const resultEmbed = new EmbedBuilder()
        .setTitle(win ? "✅ VIP WIN!" : push ? "🤝 PUSH" : "❌ HOUSE WINS")
        .setColor(win ? 0x2ecc71 : push ? 0xf1c40f : 0xe74c3c)
        .addFields(
          {
            name: "👤 YOUR HAND",
            value: `${playerHand.map((c) => c.id).join(" ")}\n*${pRes.label}*`,
            inline: true,
          },
          {
            name: "🤖 HOUSE HAND",
            value: `${houseHand.map((c) => c.id).join(" ")}\n*${hRes.label}*`,
            inline: true,
          },
          {
            name: "🎴 BOARD",
            value: `\` ${board.map((c) => c.id).join("  ")} \``,
            inline: false,
          },
          {
            name: "💰 RESULT",
            value: win
              ? `+${(payout - totalBet).toLocaleString()} Gold`
              : push
                ? `Returned ${totalBet.toLocaleString()}`
                : `-${totalBet.toLocaleString()} Gold`,
            inline: true,
          },
          {
            name: "💳 BALANCE",
            value: `**${finalUser.passBalance.toLocaleString()}** gold`,
            inline: true,
          },
        );

      await i.update({ embeds: [resultEmbed], components: [] });
    });

    collector.on("end", (_, reason) => {
      if (reason === "time") {
        activeGames.delete(user.id);
        interaction.editReply({
          content: "⏱️ Game timed out (Folded).",
          components: [],
        });
      }
    });
  },
};
