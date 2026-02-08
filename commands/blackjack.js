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
    const currentBet = interaction.options?.getInteger("amount") || 200;

    if (activeBlackjack.has(userId)) {
      return interaction.reply({
        content: "❌ Game already in progress!",
        ephemeral: true,
      });
    }

    if (currentBet > MAX_BET || currentBet < 50) {
      return interaction.reply({
        content: `❌ Bet must be 50-${MAX_BET} gold!`,
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    // ATOMIC INITIAL DEDUCTION
    const deductionResult = await User.findOneAndUpdate(
      { userId, gold: { $gte: currentBet } },
      { $inc: { gold: -currentBet } },
      { new: true },
    );

    if (!deductionResult) {
      return interaction.editReply({ content: "❌ Not enough gold!" });
    }

    activeBlackjack.add(userId);
    const initialBalance = deductionResult.gold + currentBet;

    /* -------------------- FISHER-YATES SHUFFLE -------------------- */
    const generateDeck = () => {
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
      let newDeck = [];
      for (let i = 0; i < 6; i++) {
        for (const s of suits) {
          for (const v of values) newDeck.push(`${v}${s}`);
        }
      }
      for (let i = newDeck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [newDeck[i], newDeck[j]] = [newDeck[j], newDeck[i]];
      }
      return newDeck;
    };

    let deck = generateDeck();
    let playerHand = [deck.pop(), deck.pop()];
    let dealerHand = [deck.pop(), deck.pop()];
    let currentPot = currentBet;
    let isSplit = false;
    let splitHands = [];
    let activeHandIndex = 0;
    let isProcessing = false;

    const getVal = (hand) => {
      let total = 0,
        aces = 0;
      for (const card of hand) {
        const v = card.replace(/[♠️❤️♣️♦️]/g, "");
        if (v === "A") {
          aces++;
          total += 1;
        } else if (["J", "Q", "K"].includes(v)) total += 10;
        else total += parseInt(v);
      }
      while (aces > 0 && total + 10 <= 21) {
        total += 10;
        aces--;
      }
      return total;
    };

    const cardVal = (card) => card.replace(/[♠️❤️♣️♦️]/g, "").trim();

    const createEmbed = (
      title,
      color,
      showDealer = false,
      status = "Your move!",
    ) => {
      return new EmbedBuilder()
        .setTitle(title)
        .setColor(color)
        .setDescription(`**GAME STATUS**\n> ${status}\n${"▬".repeat(25)}`)
        .addFields(
          {
            name: "👤 PLAYER",
            value: `**${playerHand.join(" ")}**\nValue: ${getVal(playerHand)}`,
            inline: true,
          },
          {
            name: "🏦 DEALER",
            value: showDealer
              ? `**${dealerHand.join(" ")}**\nValue: ${getVal(dealerHand)}`
              : `**${dealerHand[0]}** ??`,
            inline: true,
          },
        )
        .setFooter({
          text: `💰 Bet: ${currentPot} | Shoe: Fisher-Yates Randomized`,
        });
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
      // OPTIMISTIC SPLIT: No DB read here; atomic deduction handles the check later
      if (
        playerHand.length === 2 &&
        cardVal(playerHand[0]) === cardVal(playerHand[1]) &&
        !isSplit
      ) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId("split")
            .setLabel("Split")
            .setStyle(ButtonStyle.Success),
        );
      }
      return row;
    };

    if (getVal(playerHand) === 21) {
      activeBlackjack.delete(userId);
      const dVal = getVal(dealerHand);
      const payout = dVal === 21 ? currentPot : Math.floor(currentPot * 2.5);
      const finalUser = await User.findOneAndUpdate(
        { userId },
        { $inc: { gold: payout } },
        { new: true },
      );
      return interaction.editReply({
        embeds: [
          createEmbed(
            "🎉 BLACKJACK!",
            0x2ecc71,
            true,
            dVal === 21 ? "🤝 **PUSH**" : "💰 **WINNER!**",
          ),
        ],
        components: [],
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
      if (isProcessing) return;
      isProcessing = true;

      try {
        if (i.customId === "hit") {
          playerHand.push(deck.pop());
          if (getVal(playerHand) >= 21) {
            if (isSplit && activeHandIndex === 0) {
              activeHandIndex = 1;
              playerHand = splitHands[1];
              await i.update({
                embeds: [createEmbed("🃏 SPLIT: Hand 2", 0x5865f2)],
                components: [buildButtons()],
              });
            } else {
              collector.stop("ended");
              await i.deferUpdate().catch(() => null);
            }
          } else {
            await i.update({
              embeds: [
                createEmbed(
                  isSplit
                    ? `🃏 SPLIT: Hand ${activeHandIndex + 1}`
                    : "🃏 BLACKJACK",
                  0x5865f2,
                ),
              ],
              components: [buildButtons()],
            });
          }
        } else if (i.customId === "split") {
          const splitResult = await User.updateOne(
            { userId, gold: { $gte: currentBet } },
            { $inc: { gold: -currentBet } },
          );
          if (splitResult.modifiedCount === 0) {
            return i.reply({
              content: "❌ Not enough gold to split!",
              ephemeral: true,
            });
          }
          currentPot += currentBet;
          isSplit = true;
          splitHands = [
            [playerHand[0], deck.pop()],
            [playerHand[1], deck.pop()],
          ];
          playerHand = splitHands[0];
          activeHandIndex = 0;
          await i.update({
            embeds: [createEmbed("🃏 SPLIT: Hand 1", 0x5865f2)],
            components: [buildButtons()],
          });
        } else if (i.customId === "stand") {
          if (isSplit && activeHandIndex === 0) {
            activeHandIndex = 1;
            playerHand = splitHands[1];
            await i.update({
              embeds: [createEmbed("🃏 SPLIT: Hand 2", 0x5865f2)],
              components: [buildButtons()],
            });
          } else {
            collector.stop("ended");
            await i.deferUpdate().catch(() => null);
          }
        }
      } catch (e) {
        console.error("Collector Error:", e);
      } finally {
        isProcessing = false;
      }
    });

    collector.on("end", async (_, reason) => {
      try {
        if (reason === "time") {
          return interaction
            .editReply({
              embeds: [
                createEmbed(
                  "⏱️ EXPIRED",
                  0x34495e,
                  true,
                  "Timed out. Bet forfeited.",
                ),
              ],
              components: [],
            })
            .catch(() => null);
        }

        let dVal = getVal(dealerHand);
        const pHands = isSplit ? splitHands : [playerHand];
        if (pHands.some((h) => getVal(h) <= 21)) {
          while (dVal < 17) {
            dealerHand.push(deck.pop());
            dVal = getVal(dealerHand);
          }
        }

        let totalPayout = 0,
          handResults = [];
        for (let idx = 0; idx < pHands.length; idx++) {
          const pVal = getVal(pHands[idx]);
          const label = isSplit ? `Hand ${idx + 1}` : "Game";
          if (pVal > 21) handResults.push(`${label}: 💀 BUST`);
          else if (dVal > 21 || pVal > dVal) {
            totalPayout += currentBet * 2;
            handResults.push(`${label}: ✅ WIN`);
          } else if (pVal === dVal) {
            totalPayout += currentBet;
            handResults.push(`${label}: 🤝 PUSH`);
          } else handResults.push(`${label}: ❌ LOSE`);
        }

        const finalUser = await User.findOneAndUpdate(
          { userId },
          { $inc: { gold: totalPayout } },
          { new: true },
        );
        await interaction
          .editReply({
            embeds: [
              createEmbed(
                totalPayout > currentPot ? "🎉 WINNER" : "💀 RESULT",
                totalPayout > currentPot ? 0x2ecc71 : 0xe74c3c,
                true,
                handResults.join("\n"),
              ),
            ],
            components: [],
          })
          .catch(() => null);

        logToAudit(interaction.client, {
          userId,
          bet: currentBet,
          amount: totalPayout - currentPot,
          oldBalance: initialBalance,
          newBalance: finalUser.gold,
          reason: `Blackjack: ${isSplit ? "Split" : "Standard"}`,
        });
      } catch (err) {
        console.error("End Logic Error:", err);
      } finally {
        // GUARANTEED UNLOCK
        activeBlackjack.delete(userId);
      }
    });
  },
};
