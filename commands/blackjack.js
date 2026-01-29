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

module.exports = {
  name: "blackjack",
  async execute(interaction, repeatAmount = null) {
    const userId = interaction.user.id;

    if (!repeatAmount && !interaction.replied && !interaction.deferred) {
      await interaction.deferReply();
    }

    if (activeBlackjack.has(userId)) {
      const msg = "❌ You already have a game in progress!";
      return repeatAmount
        ? interaction.followUp({ content: msg, ephemeral: true })
        : interaction.editReply({ content: msg });
    }

    let currentBet = repeatAmount ?? interaction.options.getInteger("amount");

    const userData = await User.findOne({ userId });
    if (!userData || userData.gold < currentBet) {
      return interaction.editReply({
        content: `❌ Not enough gold! Balance: \`${userData?.gold || 0}\``,
      });
    }

    await User.updateOne({ userId }, { $inc: { gold: -currentBet } });
    const initialBalance = userData.gold;

    activeBlackjack.add(userId);
    const failSafe = setTimeout(() => activeBlackjack.delete(userId), 60000);

    // ===== Deck (6-deck shoe) =====
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
    const DECKS = 6;

    let deck = [];
    for (let i = 0; i < DECKS; i++) {
      for (const s of suits) for (const v of values) deck.push(`\`${v}${s}\``);
    }

    // Fisher–Yates shuffle
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    // ===== Hand value =====
    const getVal = (hand) => {
      let val = 0,
        aces = 0;
      for (const card of hand) {
        const v = card.replace(/[`♠️❤️♣️♦️]/g, "");
        if (v === "A") aces++;
        else if (["J", "Q", "K"].includes(v)) val += 10;
        else val += parseInt(v);
      }
      for (let i = 0; i < aces; i++) {
        val += val + 11 <= 21 ? 11 : 1;
      }
      return val;
    };

    let playerHand = [deck.pop(), deck.pop()];
    let dealerHand = [deck.pop(), deck.pop()];
    let baseBet = currentBet;

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
          {
            name: "🂠 Cards remaining",
            value: `\`${deck.length}\``,
          },
        )
        .setFooter({ text: `💰 Bet: ${currentBet}` });

    // ===== Finish Game =====
    const finishGame = async () => {
      clearTimeout(failSafe);
      activeBlackjack.delete(userId);

      // Dealer logic with subtle bias (feels natural)
      while (true) {
        const dVal = getVal(dealerHand);
        if (dVal < 16) {
          dealerHand.push(deck.pop());
          continue;
        }
        if (dVal === 16 && Math.random() < 0.65) {
          dealerHand.push(deck.pop());
          continue;
        }
        if (dVal === 17 && Math.random() < 0.25) {
          dealerHand.push(deck.pop());
          continue;
        }
        break;
      }

      const p = getVal(playerHand);
      const d = getVal(dealerHand);

      let payout = 0;
      let statusText = "";
      let winType = "loss";

      if (p > 21) {
        statusText = "💥 **BUST!**";
      } else if (d > 21) {
        payout = currentBet * 2;
        statusText = "✅ **DEALER BUSTS!**";
        winType = "win";
      } else if (p === d) {
        payout = currentBet;
        statusText = "🤝 **PUSH**";
        winType = "push";
      } else if (p > d) {
        payout = currentBet * 2;
        statusText = "✅ **YOU WIN!**";
        winType = "win";
      } else {
        statusText = "❌ **YOU LOSE**";
      }

      const updatedUser = await User.findOneAndUpdate(
        { userId },
        { $inc: { gold: payout } },
        { new: true },
      );

      const endEmbed = createEmbed(
        winType === "win"
          ? "🎉 WINNER"
          : winType === "push"
            ? "🤝 TIED"
            : "💀 DEFEAT",
        winType === "win" ? 0x2ecc71 : winType === "push" ? 0x95a5a6 : 0xe74c3c,
        true,
        statusText,
      );

      await interaction.editReply({ embeds: [endEmbed], components: [] });

      logToAudit(interaction.client, {
        userId,
        bet: baseBet,
        amount: payout - currentBet,
        oldBalance: initialBalance,
        newBalance: updatedUser.gold,
        reason: `Blackjack: ${statusText.replace(/\*\*/g, "")}`,
      }).catch(() => null);
    };

    // ===== UI =====
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

    const msg = await interaction.editReply({
      embeds: [createEmbed("🃏 BLACKJACK", 0x5865f2)],
      components: [row],
    });

    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 45000,
    });

    collector.on("collect", async (i) => {
      if (i.user.id !== userId)
        return i.reply({ content: "Not your game!", ephemeral: true });

      if (i.customId === "hit") {
        playerHand.push(deck.pop());
        if (getVal(playerHand) > 21) return collector.stop();
        return i.update({ embeds: [createEmbed("🃏 BLACKJACK", 0x5865f2)] });
      }

      await i.deferUpdate();
      collector.stop();
    });

    collector.on("end", finishGame);
  },
};
