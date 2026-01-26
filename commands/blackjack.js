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

    // 1. Handling the Interaction Lifecycle
    if (!repeatAmount && !interaction.replied && !interaction.deferred) {
      await interaction.deferReply();
    }

    if (activeBlackjack.has(userId)) {
      const lockMsg = "❌ You already have a game in progress!";
      return repeatAmount
        ? interaction.followUp({ content: lockMsg, ephemeral: true })
        : interaction.editReply({ content: lockMsg });
    }

    const amount = repeatAmount ?? interaction.options.getInteger("amount");

    try {
      const userData = await User.findOne({ userId });
      if (!userData || userData.gold < amount) {
        const err = `❌ Not enough gold! Balance: \`${userData?.gold?.toLocaleString() || 0}\``;
        return repeatAmount
          ? interaction.followUp({ content: err, ephemeral: true })
          : interaction.editReply({ content: err });
      }

      activeBlackjack.add(userId);
      const failSafe = setTimeout(() => activeBlackjack.delete(userId), 60000);

      // Deck Logic
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

      const createEmbed = (
        title,
        color,
        showDealer = false,
        status = "Your move!",
      ) => {
        return new EmbedBuilder()
          .setTitle(title)
          .setColor(color)
          .setDescription(`**GAME STATUS**\n> ${status}\n` + `▬`.repeat(25))
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
          .setFooter({
            text: `💰 Bet: ${amount.toLocaleString()} | Balance: ${userData.gold.toLocaleString()}`,
          });
      };

      // Define the finishGame function inside try/catch so it has access to scope
      const finishGame = async (reason) => {
        clearTimeout(failSafe);
        activeBlackjack.delete(userId);

        if (reason === "stand") {
          while (getVal(dealerHand) < 17) dealerHand.push(deck.pop());
        }

        const finalPVal = getVal(playerHand);
        const finalDVal = getVal(dealerHand);
        let netChange = 0,
          statusText = "",
          winType = "loss";

        if (reason === "natural") {
          netChange = Math.floor(amount * 1.5);
          statusText = "💰 **NATURAL!** Unstoppable 21!";
          winType = "win";
        } else if (finalPVal > 21) {
          netChange = -amount;
          statusText = "💥 **BUST!** You went over.";
        } else if (finalDVal > 21) {
          netChange = amount;
          statusText = "🏦 **DEALER BUSTS!** You win!";
          winType = "win";
        } else if (finalPVal > finalDVal) {
          netChange = amount;
          statusText = `✅ **WIN!** ${finalPVal} vs ${finalDVal}`;
          winType = "win";
        } else if (finalPVal < finalDVal) {
          netChange = -amount;
          statusText = `❌ **LOSE!** ${finalDVal} beats ${finalPVal}`;
        } else {
          statusText = "🤝 **PUSH.** It's a tie.";
          winType = "push";
        }

        await User.updateOne({ userId }, { $inc: { gold: netChange } });

        const endEmbed = createEmbed(
          winType === "push"
            ? "🤝 TIED"
            : winType === "win"
              ? "🎉 WINNER"
              : "💀 DEFEAT",
          winType === "push"
            ? 0x95a5a6
            : winType === "win"
              ? 0x2ecc71
              : 0xe74c3c,
          true,
          statusText,
        );

        const repeatRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`bj_rep_${amount}`)
            .setLabel("Play Again")
            .setStyle(ButtonStyle.Success),
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
            return this.execute(btn, amount);
          }
          await btn.update({ components: [] });
          repeatCollector.stop();
        });

        logToAudit(interaction.client, {
          userId,
          amount: netChange,
          reason: `Blackjack: ${statusText.replace(/\*\*/g, "")}`,
        }).catch(() => null);
      };

      // STARTING THE VISUAL GAME
      const pVal = getVal(playerHand);
      if (pVal === 21) {
        // We must editReply first to satisfy Discord, then finish
        await interaction.editReply({
          embeds: [createEmbed("🃏 BLACKJACK", 0x5865f2, true, "Blackjack!")],
        });
        return finishGame("natural");
      }

      const canDouble = userData.gold >= amount * 2;
      const gameRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("hit")
          .setLabel("Hit")
          .setStyle(ButtonStyle.Primary)
          .setEmoji("➕"),
        new ButtonBuilder()
          .setCustomId("stand")
          .setLabel("Stand")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("🛑"),
      );
      if (canDouble) {
        gameRow.addComponents(
          new ButtonBuilder()
            .setCustomId("double")
            .setLabel("Double")
            .setStyle(ButtonStyle.Danger)
            .setEmoji("💰"),
        );
      }

      const msg = await interaction.editReply({
        embeds: [createEmbed("🃏 BLACKJACK", 0x5865f2)],
        components: [gameRow],
        fetchReply: true,
      });

      const collector = msg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 30000,
      });

      collector.on("collect", async (i) => {
        if (i.user.id !== userId)
          return i.reply({ content: "Not your game!", ephemeral: true });

        if (i.customId === "hit") {
          playerHand.push(deck.pop());
          if (getVal(playerHand) > 21) return collector.stop("bust");

          await i.update({
            embeds: [createEmbed("🃏 BLACKJACK", 0x5865f2, false, "You hit!")],
            components: [
              new ActionRowBuilder().addComponents(
                gameRow.components[0],
                gameRow.components[1],
              ),
            ],
          });
        } else if (i.customId === "double") {
          playerHand.push(deck.pop());
          // Double the internal amount for the database update later
          const originalAmount = amount;
          const doubleAmount = amount * 2;
          // Note: Logic inside finishGame will use the scoped 'amount', so we update it here
          module.exports.execute.amount = doubleAmount;

          collector.stop(getVal(playerHand) > 21 ? "bust" : "stand");
          await i.deferUpdate();
        } else {
          collector.stop("stand");
          await i.deferUpdate();
        }
      });

      collector.on("end", (collected, reason) => {
        if (reason === "time") {
          activeBlackjack.delete(userId);
          return interaction.editReply({ components: [] }).catch(() => null);
        }
        finishGame(reason);
      });
    } catch (err) {
      console.error(err);
      activeBlackjack.delete(userId);
      if (interaction.deferred || interaction.replied) {
        await interaction
          .editReply({ content: "❌ A system error occurred." })
          .catch(() => null);
      }
    }
  },
};
