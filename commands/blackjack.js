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
    const initialBalance = userData.gold;
    await User.updateOne({ userId }, { $inc: { gold: -currentBet } });

    let currentPot = currentBet;
    let isProcessing = false;
    let endedByPlayer = false;

    // --- DECK GENERATION (6 Decks) ---
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

    // --- STEALTH RIGGING ---
    const shouldPlayerLose = Math.random() > 0.4;

    const riggedPop = (targetLoss = false, currentHandValue = 0) => {
      if (!targetLoss) return deck.pop();
      // Search for a bust card (10+)
      const cardIdx = deck.findIndex((card) => {
        const val = getVal([card]);
        return currentHandValue + val > 21;
      });
      if (cardIdx !== -1 && Math.random() > 0.4) {
        return deck.splice(cardIdx, 1)[0];
      }
      return deck.pop();
    };

    let playerHand = [deck.pop(), deck.pop()];
    let dealerHand = [deck.pop(), deck.pop()];

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
            inline: false,
          },
        )
        .setFooter({
          text: `💰 Bet: ${currentPot} | Session ID: ${Math.floor(Math.random() * 99999)}`,
        });

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
      if (playerHand.length === 2 && freshUser.gold >= currentBet) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId("double")
            .setLabel("Double Down")
            .setStyle(ButtonStyle.Danger),
        );
      }
      return row;
    };

    // Initial Blackjack Check
    if (getVal(playerHand) === 21) {
      activeBlackjack.delete(userId);
      endedByPlayer = true;
      const dVal = getVal(dealerHand);
      const payout = dVal === 21 ? currentPot : Math.floor(currentPot * 2.5);
      await User.updateOne({ userId }, { $inc: { gold: payout } });
      return interaction.editReply({
        embeds: [
          createEmbed(
            "🎉 WINNER",
            0x2ecc71,
            true,
            dVal === 21 ? "🤝 **PUSH (Both 21)**" : "🂡 **BLACKJACK!**",
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
          isProcessing = false;
        }
      } else if (i.customId === "double") {
        const freshUser = await User.findOne({ userId });
        if (freshUser.gold < currentBet) {
          isProcessing = false;
          return i.reply({
            content: "❌ Not enough gold to double!",
            ephemeral: true,
          });
        }
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
      if (!endedByPlayer) endedByPlayer = true;

      let pVal = getVal(playerHand);
      let dVal = getVal(dealerHand);

      if (pVal <= 21) {
        while (dVal < 17 || (shouldPlayerLose && dVal <= pVal && dVal < 21)) {
          dealerHand.push(deck.pop());
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
        statusText = "✅ **YOU WIN!**";
        finalTitle = "🎉 WINNER";
        finalColor = 0x2ecc71;
      } else if (pVal === dVal) {
        payout = currentPot;
        statusText = "🤝 **PUSH**";
        finalTitle = "🤝 TIED";
        finalColor = 0x95a5a6;
      } else {
        statusText = "❌ **YOU LOSE**";
      }

      const finalUser = await User.findOneAndUpdate(
        { userId },
        { $inc: { gold: payout } },
        { new: true },
      );
      await interaction
        .editReply({
          embeds: [createEmbed(finalTitle, finalColor, true, statusText)],
          components: [],
        })
        .catch(() => null);

      logToAudit(interaction.client, {
        userId,
        bet: currentBet,
        amount: payout - currentPot,
        oldBalance: initialBalance,
        newBalance: finalUser.gold,
        reason: `Blackjack: ${statusText.replace(/\*\*/g, "")}`,
      }).catch(() => null);
    });
  },
};
