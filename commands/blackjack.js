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

    activeBlackjack.add(userId);

    let isProcessing = false;
    let isGameOver = false;
    let endedByPlayer = false; // 🔑 FIX FLAG

    await User.updateOne({ userId }, { $inc: { gold: -currentBet } });

    const initialBalance = userData.gold;
    let currentPot = currentBet;

    /* ---------------- DECK ---------------- */
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

    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }

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
          { name: "🂠 Cards remaining", value: `\`${deck.length}\`` },
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

    /* ---------------- BLACKJACK CHECK ---------------- */
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
        playerHand.push(deck.pop());

        if (getVal(playerHand) >= 21) {
          isGameOver = true;
          endedByPlayer = true;
          await i.deferUpdate();
          collector.stop("ended");
        } else {
          await i.update({
            embeds: [createEmbed("🃏 BLACKJACK", 0x5865f2)],
            components: [await buildButtons()],
          });
          isProcessing = false;
        }
      } else if (i.customId === "double") {
        const checkGold = await User.findOne({ userId });
        if (checkGold.gold < currentBet) {
          isProcessing = false;
          return i.reply({
            content: "❌ Not enough gold to double!",
            ephemeral: true,
          });
        }

        await User.updateOne({ userId }, { $inc: { gold: -currentBet } });
        currentPot *= 2;
        playerHand.push(deck.pop());

        isGameOver = true;
        endedByPlayer = true;
        await i.deferUpdate();
        collector.stop("ended");
      } else if (i.customId === "stand") {
        isGameOver = true;
        endedByPlayer = true;
        await i.deferUpdate();
        collector.stop("ended");
      }
    });

    collector.on("end", async () => {
      activeBlackjack.delete(userId);

      /* ---------------- AFK REFUND ---------------- */
      if (!endedByPlayer) {
        await User.updateOne({ userId }, { $inc: { gold: currentPot } });

        return interaction
          .editReply({
            embeds: [
              createEmbed(
                "⏲️ AFK - TIMED OUT",
                0x95a5a6,
                true,
                "You went AFK. Bet refunded.",
              ),
            ],
            components: [],
          })
          .catch(() => null);
      }

      /* ---------------- GAME RESOLUTION ---------------- */
      let pVal = getVal(playerHand);
      let dVal = getVal(dealerHand);

      if (pVal <= 21) {
        while (dVal < 17) {
          dealerHand.push(deck.pop());
          dVal = getVal(dealerHand);
        }
      }

      let statusText = "";
      let payout = 0;
      let finalTitle = "💀 DEFEAT";
      let finalColor = 0xe74c3c;

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
