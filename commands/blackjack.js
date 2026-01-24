const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const User = require("../models/User");
const { logToAudit } = require("../utils/logger"); // ✅ Added Logger Import

module.exports = {
  name: "blackjack",
  async execute(interaction, repeatAmount = null) {
    let amount = repeatAmount ?? interaction.options.getInteger("amount");
    const userId = interaction.user.id;

    // 1. FETCH USER FROM MONGODB
    const userData = await User.findOne({ userId });

    if (!userData) {
      const err =
        "❌ You are not registered! Please use the registration panel first.";
      return interaction.replied || interaction.deferred
        ? interaction.followUp({ content: err, ephemeral: true })
        : interaction.reply({ content: err, ephemeral: true });
    }

    if (userData.gold < amount) {
      const err = `❌ Not enough gold! Balance: \`${userData.gold.toLocaleString()}\``;
      return interaction.replied || interaction.deferred
        ? interaction.followUp({ content: err, ephemeral: true })
        : interaction.reply({ content: err, ephemeral: true });
    }

    // --- DECK & HAND LOGIC ---
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
      status = "Dealing...",
      image = null,
    ) => {
      const pVal = getVal(playerHand);
      const dVal = getVal(dealerHand);
      const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor(color)
        .setDescription(`**GAME STATUS**\n> ${status}\n` + `▬`.repeat(25))
        .addFields(
          {
            name: "👤 PLAYER",
            value: `**${playerHand.join(" ")}**\nValue: \`${pVal}\``,
            inline: true,
          },
          {
            name: "🏦 DEALER",
            value: showDealer
              ? `**${dealerHand.join(" ")}**\nValue: \`${dVal}\``
              : `**${dealerHand[0]}** \`??\``,
            inline: true,
          },
        )
        .setFooter({
          text: `💰 Bet: ${amount.toLocaleString()} | Balance: ${userData.gold.toLocaleString()}`,
        });
      if (image) embed.setImage(image);
      return embed;
    };

    // Initial message
    const msg = await (interaction.replied || interaction.deferred
      ? interaction.editReply({
          embeds: [
            createEmbed(
              "🃏 BLACKJACK",
              0x2f3136,
              false,
              "Shuffling...",
              "https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExYnd2ZWc1ODZvMWFzdHcyZjExZmQxemFjaHNuZXhhbTJob3BmMDd6biZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/26ufkBRB1E836CxYA/giphy.gif",
            ),
          ],
          components: [],
        })
      : interaction.reply({
          embeds: [
            createEmbed(
              "🃏 BLACKJACK",
              0x2f3136,
              false,
              "Shuffling...",
              "https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExYnd2ZWc1ODZvMWFzdHcyZjExZmQxemFjaHNuZXhhbTJob3BmMDd6biZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/26ufkBRB1E836CxYA/giphy.gif",
            ),
          ],
          fetchReply: true,
        }));

    // Start game after delay
    setTimeout(async () => {
      const pVal = getVal(playerHand);
      if (pVal === 21) return finishGame("natural");

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
            .setLabel("Double Down")
            .setStyle(ButtonStyle.Danger)
            .setEmoji("💰"),
        );
      }

      await interaction.editReply({
        embeds: [createEmbed("🃏 BLACKJACK", 0x5865f2, false, "Your move!")],
        components: [gameRow],
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
            embeds: [
              createEmbed("🃏 BLACKJACK", 0x5865f2, false, "Drawing card..."),
            ],
            components: [
              new ActionRowBuilder().addComponents(
                gameRow.components[0],
                gameRow.components[1],
              ),
            ],
          });
        } else if (i.customId === "double") {
          amount *= 2;
          playerHand.push(deck.pop());
          collector.stop(getVal(playerHand) > 21 ? "bust" : "stand");
          await i.deferUpdate();
        } else {
          collector.stop("stand");
          await i.deferUpdate();
        }
      });

      collector.on("end", async (_, reason) => {
        if (reason !== "time") finishGame(reason);
      });

      async function finishGame(reason) {
        if (reason === "stand")
          while (getVal(dealerHand) < 17) dealerHand.push(deck.pop());

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

        // --- 1. MONGODB: UPDATE BALANCE ---
        userData.gold += netChange;
        await userData.save();

        // --- 2. LOG TO AUDIT ---
        await logToAudit(interaction.client, {
          userId,
          amount: netChange,
          reason: `Blackjack: ${statusText.replace(/\*\*/g, "")}`,
        }).catch((err) => console.error("Logger Error:", err));

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
            .setCustomId(`bj_repeat_${amount}`)
            .setLabel(`Play Again (${amount})`)
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
          if (btn.customId.startsWith("bj_repeat_")) {
            await btn.deferUpdate();
            repeatCollector.stop();
            return module.exports.execute(btn, amount);
          }
          await btn.update({ components: [] });
          repeatCollector.stop();
        });
      }
    }, 1500);
  },
};
