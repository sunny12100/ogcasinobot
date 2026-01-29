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
  async execute(interaction) {
    const userId = interaction.user.id;
    const currentBet = interaction.options.getInteger("amount");

    if (activeBlackjack.has(userId)) {
      return interaction.reply({
        content: "❌ You already have a game in progress!",
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    const userData = await User.findOne({ userId });
    if (!userData || userData.gold < currentBet) {
      return interaction.editReply({
        content: `❌ Not enough gold! Balance: \`${userData?.gold || 0}\``,
      });
    }

    // --- LOCK AND DEDUCT ---
    activeBlackjack.add(userId);
    let isProcessing = false; // Race condition protection
    await User.updateOne({ userId }, { $inc: { gold: -currentBet } });

    const initialBalance = userData.gold;
    let currentPot = currentBet;
    let availableGold = userData.gold - currentBet;

    // --- 6 DECK SHOE & SHUFFLE ---
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
    for (let d = 0; d < 6; d++) {
      for (const s of suits) {
        for (const v of values) deck.push(`${v}${s}`);
      }
    }
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    const getVal = (hand) => {
      let total = 0;
      let aces = 0;
      for (const card of hand) {
        const v = card.replace(/[♠️❤️♣️♦️]/g, "");
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

    const createEmbed = (
      title,
      color,
      showDealer = false,
      status = "Your move!",
    ) => {
      return new EmbedBuilder()
        .setTitle(title)
        .setColor(color)
        .setDescription(`**STATUS:** ${status}`)
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
        .setFooter({ text: `💰 Current Bet: ${currentPot.toLocaleString()}` });
    };

    const buildButtons = (disabled = false) => {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("hit")
          .setLabel("Hit")
          .setStyle(ButtonStyle.Primary)
          .setDisabled(disabled),
        new ButtonBuilder()
          .setCustomId("stand")
          .setLabel("Stand")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled),
      );

      if (playerHand.length === 2 && availableGold >= currentBet && !disabled) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId("double")
            .setLabel("Double Down")
            .setStyle(ButtonStyle.Danger),
        );
      }
      return row;
    };

    // --- CHECK NATURAL BLACKJACK ---
    if (getVal(playerHand) === 21) {
      activeBlackjack.delete(userId);
      const dVal = getVal(dealerHand);
      let payout = dVal === 21 ? currentBet : Math.floor(currentBet * 2.5);
      let statusMsg =
        dVal === 21 ? "Push! Both have Blackjack." : "Blackjack! 3:2 Payout.";

      const finalUser = await User.findOneAndUpdate(
        { userId },
        { $inc: { gold: payout } },
        { new: true },
      );
      await interaction.editReply({
        embeds: [createEmbed("🃏 BLACKJACK", 0x2ecc71, true, statusMsg)],
        components: [],
      });

      return logToAudit(interaction.client, {
        userId,
        bet: currentBet,
        amount: payout - currentBet,
        oldBalance: initialBalance,
        newBalance: finalUser.gold,
        reason: "Blackjack Natural",
      });
    }

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
      if (isProcessing) return; // Ignore fast double-clicks

      isProcessing = true;
      await i.deferUpdate(); // Prevents "Interaction Failed" error

      if (i.customId === "hit") {
        playerHand.push(deck.pop());
        const pVal = getVal(playerHand);

        if (pVal >= 21) {
          collector.stop();
        } else {
          await interaction.editReply({
            embeds: [createEmbed("🃏 BLACKJACK", 0x5865f2)],
            components: [buildButtons()],
          });
          isProcessing = false;
        }
      } else if (i.customId === "double") {
        await User.updateOne({ userId }, { $inc: { gold: -currentBet } });
        currentPot *= 2;
        playerHand.push(deck.pop());
        collector.stop();
      } else if (i.customId === "stand") {
        collector.stop();
      }
    });

    collector.on("end", async (collected, reason) => {
      activeBlackjack.delete(userId);
      let pVal = getVal(playerHand);
      let dVal = getVal(dealerHand);

      // --- DEALER AI ---
      if (pVal <= 21) {
        while (dVal < 17) {
          dealerHand.push(deck.pop());
          dVal = getVal(dealerHand);
        }
      }

      let resultText = "";
      let payout = 0;
      let finalColor = 0xe74c3c;

      if (pVal > 21) {
        resultText = "Bust! You went over 21.";
      } else if (dVal > 21) {
        resultText = "Dealer Busts! You win.";
        payout = currentPot * 2;
        finalColor = 0x2ecc71;
      } else if (pVal > dVal) {
        resultText = "You beat the dealer!";
        payout = currentPot * 2;
        finalColor = 0x2ecc71;
      } else if (pVal === dVal) {
        resultText = "Push! Your bet was returned.";
        payout = currentPot;
        finalColor = 0x95a5a6;
      } else {
        resultText = "Dealer wins.";
      }

      const finalUser = await User.findOneAndUpdate(
        { userId },
        { $inc: { gold: payout } },
        { new: true },
      );

      await interaction
        .editReply({
          embeds: [createEmbed("🔚 GAME OVER", finalColor, true, resultText)],
          components: [],
        })
        .catch(() => null);

      logToAudit(interaction.client, {
        userId,
        bet: currentBet,
        amount: payout - currentPot,
        oldBalance: initialBalance,
        newBalance: finalUser.gold,
        reason: `Blackjack Result: ${resultText}`,
      }).catch(() => null);
    });
  },
};
