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
      return interaction.editReply({
        content: "❌ You already have a blackjack game running!",
      });
    }

    let bet = repeatAmount ?? interaction.options.getInteger("amount");

    const userData = await User.findOne({ userId });
    if (!userData || userData.gold < bet) {
      return interaction.editReply({
        content: `❌ Not enough gold! Balance: \`${userData?.gold || 0}\``,
      });
    }

    // 🔒 LOCK BET IMMEDIATELY
    await User.updateOne({ userId }, { $inc: { gold: -bet } });

    const initialBalance = userData.gold;
    activeBlackjack.add(userId);

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
    let currentBet = bet;

    const createEmbed = (status, showDealer = false) =>
      new EmbedBuilder()
        .setTitle("🃏 BLACKJACK")
        .setColor(0x5865f2)
        .setDescription(`> ${status}`)
        .addFields(
          {
            name: "👤 PLAYER",
            value: `${playerHand.join(" ")}\nValue: \`${getVal(playerHand)}\``,
            inline: true,
          },
          {
            name: "🏦 DEALER",
            value: showDealer
              ? `${dealerHand.join(" ")}\nValue: \`${getVal(dealerHand)}\``
              : `${dealerHand[0]} \`??\``,
            inline: true,
          },
        )
        .setFooter({ text: `💰 Bet: ${currentBet}` });

    const finish = async (reason) => {
      activeBlackjack.delete(userId);

      while (getVal(dealerHand) < 17) dealerHand.push(deck.pop());

      const p = getVal(playerHand);
      const d = getVal(dealerHand);

      let net = 0;
      let status = "";

      if (reason === "natural") {
        net = Math.floor(currentBet * 2.5);
        status = "💰 **BLACKJACK!**";
      } else if (p > 21) {
        net = 0;
        status = "💥 **BUST!**";
      } else if (d > 21 || p > d) {
        net = currentBet * 2;
        status = "✅ **YOU WIN!**";
      } else if (p === d) {
        net = currentBet;
        status = "🤝 **PUSH**";
      } else {
        net = 0;
        status = "❌ **YOU LOSE**";
      }

      const updated = await User.findOneAndUpdate(
        { userId },
        { $inc: { gold: net } },
        { new: true },
      );

      await interaction.editReply({
        embeds: [createEmbed(status, true)],
        components: [],
      });

      logToAudit(interaction.client, {
        userId,
        bet: currentBet,
        amount: net - currentBet,
        oldBalance: initialBalance,
        newBalance: updated.gold,
        reason: `Blackjack: ${status.replace(/\*\*/g, "")}`,
      }).catch(() => null);
    };

    // 🟢 NATURAL CHECK (PLAYER + DEALER)
    const pVal = getVal(playerHand);
    const dVal = getVal(dealerHand);

    if (pVal === 21 || dVal === 21) {
      if (pVal === 21 && dVal === 21) {
        await User.updateOne({ userId }, { $inc: { gold: bet } });
        return interaction.editReply({
          embeds: [createEmbed("🤝 DOUBLE BLACKJACK!", true)],
        });
      }
      if (pVal === 21) return finish("natural");
      return interaction.editReply({
        embeds: [createEmbed("❌ Dealer Blackjack!", true)],
      });
    }

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

    const msg = await interaction.editReply({
      embeds: [createEmbed("Your move!")],
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
        if (getVal(playerHand) > 21) return collector.stop("bust");
        return i.update({
          embeds: [createEmbed("You hit!")],
          components: [row],
        });
      }

      if (i.customId === "double") {
        await User.updateOne({ userId }, { $inc: { gold: -bet } });
        currentBet *= 2;
        playerHand.push(deck.pop());
        return collector.stop("stand");
      }

      collector.stop("stand");
      await i.deferUpdate();
    });

    collector.on("end", (_, reason) => finish(reason));
  },
};
