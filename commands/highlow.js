const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const User = require("../models/User");
const { logToAudit } = require("../utils/logger");
const crypto = require("crypto");

const activeHighLow = new Set();
const MAX_BET = 500;

function randomFloat() {
  return crypto.randomBytes(4).readUInt32BE() / 2 ** 32;
}

// 🔥 SINGLE GAME RESOLVER
async function resolveGame({
  choice,
  interaction,
  dealerIndex,
  dealerCard,
  cards,
  amount,
  userId,
  initialBalance,
  failSafe,
  isAuto = false,
}) {
  try {
    const winChance = 0.3;
    const tieChance = 0.05;

    let userIndex;

    const roll = randomFloat();

    // 🚨 EDGE HANDLING
    const isTopCard = dealerIndex === cards.length - 1;
    const isBottomCard = dealerIndex === 0;

    if (
      (choice === "higher" && isTopCard) ||
      (choice === "lower" && isBottomCard)
    ) {
      // impossible to win
      if (roll < tieChance) {
        userIndex = dealerIndex;
      } else {
        userIndex =
          choice === "higher"
            ? Math.max(0, dealerIndex - 1)
            : Math.min(cards.length - 1, dealerIndex + 1);
      }
    } else {
      // 🎯 NORMAL LOGIC
      if (roll < tieChance) {
        userIndex = dealerIndex;
      } else if (roll < tieChance + winChance) {
        // WIN
        if (choice === "higher") {
          userIndex = crypto.randomInt(dealerIndex + 1, cards.length);
        } else {
          userIndex = crypto.randomInt(0, dealerIndex);
        }
      } else {
        // LOSS
        if (choice === "higher") {
          userIndex = crypto.randomInt(0, dealerIndex);
        } else {
          userIndex = crypto.randomInt(dealerIndex + 1, cards.length);
        }
      }
    }

    const userCard = cards[userIndex];
    const isTie = userIndex === dealerIndex;

    const won =
      !isTie &&
      ((choice === "higher" && userIndex > dealerIndex) ||
        (choice === "lower" && userIndex < dealerIndex));

    let payout = 0;
    let netChange = 0;
    let title = "";
    let color = 0;

    if (isTie) {
      payout = amount;
      title = isAuto ? "🤝 PUSH (AUTO)" : "🤝 PUSH (TIE)";
      color = 0xf1c40f;
    } else if (won) {
      payout = amount * 2;
      netChange = amount;
      title = isAuto ? "🎉 AUTO WIN!" : "🎉 YOU WON!";
      color = 0x2ecc71;
    } else {
      netChange = -amount;
      title = isAuto ? "💀 AUTO LOSS" : "💀 HOUSE WINS";
      color = 0xe74c3c;
    }

    const updatedUser = await User.findOneAndUpdate(
      { userId },
      { $inc: { gold: payout } },
      { new: true },
    );

    const resultEmbed = new EmbedBuilder()
      .setTitle(title)
      .setColor(color)
      .setDescription(
        `Dealer: **${dealerCard}**
Your Card: **${userCard}**

${
  isAuto
    ? `Auto Choice: **${choice.toUpperCase()}**`
    : `Result: **${isTie ? "Push" : won ? "Correct!" : "Wrong!"}**`
}

💰 Change: \`${netChange >= 0 ? "+" : ""}${netChange.toLocaleString()}\`
🏦 Balance: \`${updatedUser.gold.toLocaleString()}\``,
      );

    const repeatRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("hl_rep")
        .setLabel("Play Again")
        .setStyle(ButtonStyle.Success)
        .setDisabled(updatedUser.gold < amount),
      new ButtonBuilder()
        .setCustomId("hl_quit")
        .setLabel("Quit")
        .setStyle(ButtonStyle.Secondary),
    );

    const finalMsg = await interaction.editReply({
      embeds: [resultEmbed],
      components: [repeatRow],
    });

    const endCollector = finalMsg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 10000,
    });

    endCollector.on("collect", async (btnInt) => {
      if (btnInt.user.id !== userId)
        return btnInt.reply({ content: "Not yours!", ephemeral: true });

      endCollector.stop();

      if (btnInt.customId === "hl_rep") {
        activeHighLow.delete(userId);
        clearTimeout(failSafe);
        await btnInt.deferUpdate();
        return module.exports.execute(btnInt, Number(amount));
      }

      await btnInt.update({ components: [] });
    });

    await logToAudit(interaction.client, {
      userId,
      bet: amount,
      amount: netChange,
      oldBalance: initialBalance,
      newBalance: updatedUser.gold,
      reason: `HighLow: ${choice.toUpperCase()} (${dealerCard} vs ${userCard})`,
    });
  } catch (err) {
    console.error("[Resolve Error]", err);
    await User.updateOne({ userId }, { $inc: { gold: amount } }).catch(
      () => null,
    );
  } finally {
    activeHighLow.delete(userId);
    clearTimeout(failSafe);
  }
}

module.exports = {
  name: "highlow",

  async execute(interaction, repeatAmount = null) {
    const userId = interaction.user.id;
    const amount = repeatAmount ?? interaction.options?.getInteger?.("amount");

    if (!amount || amount <= 0 || amount > MAX_BET) {
      return interaction.reply({
        content: `❌ Invalid bet (1 - ${MAX_BET.toLocaleString()} gold).`,
        ephemeral: true,
      });
    }

    if (activeHighLow.has(userId)) {
      return interaction.reply({
        content: "❌ You already have a game running!",
        ephemeral: true,
      });
    }

    if (!interaction.deferred && !interaction.replied)
      await interaction.deferReply();

    let settled = false;
    let failSafe;

    try {
      const userData = await User.findOneAndUpdate(
        { userId, gold: { $gte: amount } },
        { $inc: { gold: -amount } },
        { new: true },
      );

      if (!userData) {
        const existing = await User.findOne({ userId });
        return interaction.editReply({
          content: `❌ Not enough gold! Balance: \`${(
            existing?.gold ?? 0
          ).toLocaleString()}\``,
        });
      }

      const initialBalance = userData.gold + amount;

      activeHighLow.add(userId);
      failSafe = setTimeout(() => activeHighLow.delete(userId), 35000);

      const cards = [
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

      const dealerIndex = crypto.randomInt(0, cards.length);
      const dealerCard = cards[dealerIndex];

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("higher")
          .setLabel("Higher")
          .setStyle(ButtonStyle.Success)
          .setEmoji("⬆️"),
        new ButtonBuilder()
          .setCustomId("lower")
          .setLabel("Lower")
          .setStyle(ButtonStyle.Danger)
          .setEmoji("⬇️"),
      );

      const embed = new EmbedBuilder()
        .setTitle("🃏 HIGH-LOW")
        .setColor(0x5865f2)
        .setDescription(
          `💰 **Bet:** \`${amount.toLocaleString()}\` gold

Dealer Card: **[ ${dealerCard} ]**

Will the next card be **Higher** or **Lower**?`,
        )
        .setFooter({ text: "Payout: 2× | Tie = Push" });

      const msg = await interaction.editReply({
        embeds: [embed],
        components: [row],
      });

      const collector = msg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 15000,
      });

      collector.on("collect", async (i) => {
        if (i.user.id !== userId)
          return i.reply({ content: "Not your game!", ephemeral: true });

        if (settled) return;
        settled = true;

        const choice = i.customId;

        await i.update({
          embeds: [
            new EmbedBuilder()
              .setTitle("🃏 DRAWING CARD...")
              .setColor(0xffaa00)
              .setImage(
                "https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExcDJvZzRicXRqZnJiMjR0MXJ2ZGJhc2puN2JwbW43c21xaHg3NHJpNyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/bG5rDPx76wHMZtsXmr/giphy.gif",
              ),
          ],
          components: [],
        });

        setTimeout(() => {
          resolveGame({
            choice,
            interaction,
            dealerIndex,
            dealerCard,
            cards,
            amount,
            userId,
            initialBalance,
            failSafe,
          });
        }, 2000);

        collector.stop();
      });

      collector.on("end", async (collected, reason) => {
        if (reason === "time" && !settled) {
          settled = true;

          const autoChoice = dealerIndex < 6 ? "higher" : "lower";

          await interaction.editReply({
            embeds: [
              new EmbedBuilder()
                .setTitle("⏲️ AUTO PLAY")
                .setColor(0xffaa00)
                .setDescription(
                  `No response detected.\nAuto-picked: **${autoChoice.toUpperCase()}**`,
                ),
            ],
            components: [],
          });

          setTimeout(() => {
            resolveGame({
              choice: autoChoice,
              interaction,
              dealerIndex,
              dealerCard,
              cards,
              amount,
              userId,
              initialBalance,
              failSafe,
              isAuto: true,
            });
          }, 1500);
        }
      });
    } catch (err) {
      console.error("[HighLow Fatal Error]", err);
      activeHighLow.delete(userId);
      clearTimeout(failSafe);
    }
  },
};
