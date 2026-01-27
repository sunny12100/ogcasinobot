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
      const lockMsg = "❌ You already have a game in progress!";
      return repeatAmount
        ? interaction.followUp({ content: lockMsg, ephemeral: true })
        : interaction.editReply({ content: lockMsg });
    }

    let currentBet = repeatAmount ?? interaction.options.getInteger("amount");

    const userData = await User.findOne({ userId });
    if (!userData || userData.gold < currentBet) {
      return interaction.editReply({
        content: `❌ Not enough gold! Balance: \`${userData?.gold || 0}\``,
      });
    }

    // 🔒 DEDUCT BET IMMEDIATELY
    await User.updateOne({ userId }, { $inc: { gold: -currentBet } });
    const initialBalance = userData.gold;

    activeBlackjack.add(userId);
    const failSafe = setTimeout(() => activeBlackjack.delete(userId), 60000);

    // Deck
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
    for (const s of suits) for (const v of values) deck.push(`\`${v}${s}\``);
    deck.sort(() => Math.random() - 0.5);

    const getVal = (hand) => {
      let val = 0,
        aces = 0;
      for (const card of hand) {
        const v = card.replace(/[`♠️❤️♣️♦️]/g, "");
        if (v === "A") aces++;
        else if (["J", "Q", "K"].includes(v)) val += 10;
        else val += parseInt(v);
      }
      for (let i = 0; i < aces; i++) val += val + 11 <= 21 ? 11 : 1;
      return val;
    };

    let playerHand = [deck.pop(), deck.pop()];
    let dealerHand = [deck.pop(), deck.pop()];
    let baseBet = currentBet;
    let doubled = false;

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
        .setFooter({ text: `💰 Bet: ${currentBet}` });

    const finishGame = async (reason) => {
      clearTimeout(failSafe);
      activeBlackjack.delete(userId);

      while (getVal(dealerHand) < 17) dealerHand.push(deck.pop());

      const p = getVal(playerHand);
      const d = getVal(dealerHand);

      let payout = 0;
      let statusText = "";
      let winType = "loss";

      if (reason === "natural") {
        payout = Math.floor(baseBet * 2.5);
        statusText = "💰 **BLACKJACK!**";
        winType = "win";
      } else if (p > 21) {
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
        winType === "push"
          ? "🤝 TIED"
          : winType === "win"
            ? "🎉 WINNER"
            : "💀 DEFEAT",
        winType === "win" ? 0x2ecc71 : winType === "push" ? 0x95a5a6 : 0xe74c3c,
        true,
        statusText,
      );

      const repeatRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`bj_rep_${baseBet}`)
          .setLabel("Play Again")
          .setStyle(ButtonStyle.Success)
          .setDisabled(updatedUser.gold < baseBet),
        new ButtonBuilder()
          .setCustomId("bj_quit")
          .setLabel("Quit")
          .setStyle(ButtonStyle.Secondary),
      );

      const finalMsg = await interaction.editReply({
        embeds: [endEmbed],
        components: [repeatRow],
      });

      const repeatCollector = finalMsg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 15000,
      });

      repeatCollector.on("collect", async (btn) => {
        if (btn.user.id !== userId) return;
        if (btn.customId.startsWith("bj_rep_")) {
          await btn.update({ components: [] }).catch(() => null);
          repeatCollector.stop();
          return module.exports.execute(btn, baseBet);
        }
        await btn.update({ components: [] });
        repeatCollector.stop();
      });

      logToAudit(interaction.client, {
        userId,
        bet: baseBet,
        amount: payout - currentBet,
        oldBalance: initialBalance,
        newBalance: updatedUser.gold,
        reason: `Blackjack: ${statusText.replace(/\*\*/g, "")}`,
      }).catch(() => null);
    };

    // 🟢 NATURAL CHECK
    if (getVal(playerHand) === 21) {
      await interaction.editReply({
        embeds: [createEmbed("🃏 BLACKJACK", 0x5865f2, true, "Blackjack!")],
      });
      return finishGame("natural");
    }

    const canDouble = userData.gold >= baseBet * 2;
    const gameRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("hit")
        .setLabel("Hit")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("stand")
        .setLabel("Stand")
        .setStyle(ButtonStyle.Secondary),
    );

    if (canDouble) {
      gameRow.addComponents(
        new ButtonBuilder()
          .setCustomId("double")
          .setLabel("Double Down")
          .setStyle(ButtonStyle.Danger),
      );
    }

    const msg = await interaction.editReply({
      embeds: [createEmbed("🃏 BLACKJACK", 0x5865f2)],
      components: [gameRow],
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
        if (getVal(playerHand) > 21) return collector.stop("bust");
        return i.update({ embeds: [createEmbed("🃏 BLACKJACK", 0x5865f2)] });
      }

      if (i.customId === "double") {
        await User.updateOne({ userId }, { $inc: { gold: -baseBet } });
        currentBet *= 2;
        doubled = true;
        playerHand.push(deck.pop());
        await i.deferUpdate();
        return collector.stop("stand");
      }

      await i.deferUpdate();
      collector.stop("stand");
    });

    collector.on("end", (_, reason) => finishGame(reason));
  },
};
