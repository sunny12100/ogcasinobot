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

    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    // ===== Hand value (FIXED) =====
    const getVal = (hand) => {
      let total = 0;
      let aces = 0;

      for (const card of hand) {
        const v = card.replace(/[`♠️❤️♣️♦️]/g, "");
        if (v === "A") aces++;
        else if (["J", "Q", "K"].includes(v)) total += 10;
        else total += parseInt(v);
      }

      for (let i = 0; i < aces; i++) {
        total += total + 11 <= 21 ? 11 : 1;
      }

      return total;
    };

    let playerHand = [deck.pop(), deck.pop()];
    let dealerHand = [deck.pop(), deck.pop()];
    let baseBet = currentBet;
    let canDouble = true;

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

    const finishGame = async () => {
      clearTimeout(failSafe);
      activeBlackjack.delete(userId);

      while (getVal(dealerHand) < 17) {
        dealerHand.push(deck.pop());
      }

      const p = getVal(playerHand);
      const d = getVal(dealerHand);

      let payout = 0;
      let statusText = "";
      let winType = "loss";

      if (p > 21) {
        statusText = "💥 **BUST!**";
      } else if (d > 21 || p > d) {
        payout = currentBet * 2;
        statusText = "✅ **YOU WIN!**";
        winType = "win";
      } else if (p === d) {
        payout = currentBet;
        statusText = "🤝 **PUSH**";
        winType = "push";
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

    const buildButtons = () => {
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

      if (canDouble && playerHand.length === 2 && userData.gold >= baseBet) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId("double")
            .setLabel("Double Down")
            .setStyle(ButtonStyle.Danger),
        );
      }

      return row;
    };

    const msg = await interaction.editReply({
      embeds: [createEmbed("🃏 BLACKJACK", 0x5865f2)],
      components: [buildButtons()],
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
        canDouble = false;

        if (getVal(playerHand) > 21) {
          await i.deferUpdate();
          return collector.stop();
        }

        return i.update({
          embeds: [createEmbed("🃏 BLACKJACK", 0x5865f2)],
          components: [buildButtons()],
        });
      }

      if (i.customId === "double") {
        await User.updateOne({ userId }, { $inc: { gold: -baseBet } });
        currentBet *= 2;
        playerHand.push(deck.pop());
        await i.deferUpdate();
        return collector.stop();
      }

      await i.deferUpdate();
      collector.stop();
    });

    collector.on("end", finishGame);
  },
};
