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
    await User.updateOne({ userId }, { $inc: { gold: -currentBet } });
    let currentPot = currentBet;
    let endedByPlayer = false;

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
      let total = 0,
        aces = 0;
      for (const card of hand) {
        const v = card.replace(/[`♠️❤️♣️♦️]/g, "");
        if (v === "A") aces++;
        else if (["J", "Q", "K"].includes(v)) total += 10;
        else total += parseInt(v);
      }
      for (let i = 0; i < aces; i++) total += total + 11 <= 21 ? 11 : 1;
      return total;
    };

    // --- THE RIGGING ENGINE ---
    // 40% target win rate means 60% of the time, the deck will "stack" against them.
    const shouldPlayerLose = Math.random() > 0.4;

    const riggedPop = (targetLoss = false, currentHandValue = 0) => {
      if (!targetLoss) return deck.pop();

      // If we want the player to lose, find a card that puts them over 21
      // or find a card that is low value (underwhelming).
      const cardIdx = deck.findIndex((card) => {
        const val = getVal([card]);
        return currentHandValue + val > 21; // Find a bust card
      });

      if (cardIdx !== -1 && Math.random() > 0.5) {
        return deck.splice(cardIdx, 1)[0];
      }
      return deck.pop();
    };

    let playerHand = [deck.pop(), deck.pop()];
    let dealerHand = [deck.pop(), deck.pop()];

    // Embed and Button helpers (keeping your existing style)
    const createEmbed = (
      title,
      color,
      showDealer = false,
      status = "Your move!",
    ) =>
      new EmbedBuilder()
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
        .setFooter({ text: `💰 Bet: ${currentPot}` });

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
        new ButtonBuilder()
          .setCustomId("double")
          .setLabel("Double")
          .setStyle(ButtonStyle.Danger),
      );
      return row;
    };

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

      if (i.customId === "hit") {
        // Use riggedPop to potentially force a bust if the 60% 'loss' roll happened
        playerHand.push(riggedPop(shouldPlayerLose, getVal(playerHand)));

        if (getVal(playerHand) >= 21) {
          endedByPlayer = true;
          collector.stop("ended");
          await i.deferUpdate();
        } else {
          await i.update({
            embeds: [createEmbed("🃏 BLACKJACK", 0x5865f2)],
            components: [await buildButtons()],
          });
        }
      } else if (i.customId === "double") {
        const freshUser = await User.findOne({ userId });
        if (freshUser.gold < currentBet)
          return i.reply({ content: "Not enough gold!", ephemeral: true });

        await User.updateOne({ userId }, { $inc: { gold: -currentBet } });
        currentPot *= 2;
        playerHand.push(riggedPop(shouldPlayerLose, getVal(playerHand)));
        endedByPlayer = true;
        collector.stop("ended");
        await i.deferUpdate();
      } else if (i.customId === "stand") {
        endedByPlayer = true;
        collector.stop("ended");
        await i.deferUpdate();
      }
    });

    collector.on("end", async () => {
      activeBlackjack.delete(userId);
      if (!endedByPlayer) {
        // AFK Auto-Stand (No refund)
        endedByPlayer = true;
      }

      let pVal = getVal(playerHand);
      let dVal = getVal(dealerHand);

      // --- RIGGING THE DEALER ---
      // If player didn't bust and we want them to lose, make dealer "lucky"
      if (pVal <= 21) {
        while (dVal < 17 || (shouldPlayerLose && dVal <= pVal && dVal < 21)) {
          // Dealer draws until they beat the player or hit 21
          let nextCard = deck.pop();
          dealerHand.push(nextCard);
          dVal = getVal(dealerHand);
        }
      }

      let statusText = "",
        payout = 0,
        finalTitle = "💀 DEFEAT",
        finalColor = 0xe74c3c;

      if (pVal > 21) {
        statusText = "💥 **BUST!**";
      } else if (dVal > 21 || pVal > dVal) {
        payout = currentPot * 2;
        statusText = "✅ **WIN**";
        finalTitle = "🎉 WINNER";
        finalColor = 0x2ecc71;
      } else if (pVal === dVal) {
        payout = currentPot; // TIE = PUSH
        statusText = "🤝 **PUSH**";
        finalTitle = "🤝 TIED";
        finalColor = 0x95a5a6;
      } else {
        statusText = "❌ **LOSE**";
      }

      const finalUser = await User.findOneAndUpdate(
        { userId },
        { $inc: { gold: payout } },
        { new: true },
      );
      await interaction.editReply({
        embeds: [createEmbed(finalTitle, finalColor, true, statusText)],
        components: [],
      });

      logToAudit(interaction.client, {
        userId,
        bet: currentBet,
        amount: payout - currentPot,
        oldBalance: userData.gold,
        newBalance: finalUser.gold,
        reason: `Blackjack: ${statusText}`,
      }).catch(() => null);
    });
  },
};
