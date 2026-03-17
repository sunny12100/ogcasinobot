const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  SlashCommandBuilder,
} = require("discord.js");
const PassUser = require("../models/PassUser");

const activeBlackjack = new Set();
const MAX_BET = 5000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("vip-blackjack")
    .setDescription("🎰 VIP LOUNGE: Premium Blackjack")
    .addIntegerOption((opt) =>
      opt
        .setName("amount")
        .setDescription(`Gold to bet (1-${MAX_BET.toLocaleString()})`)
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(MAX_BET),
    ),

  async execute(interaction, repeatAmount = null) {
    const userId = interaction.user.id;
    const amount = repeatAmount ?? interaction.options?.getInteger("amount");
    const LOUNGE_ROLE = "1483219208962834473";

    // 1. Initial Checks
    if (!interaction.member.roles.cache.has(LOUNGE_ROLE)) {
      return interaction.reply({
        content: "🚫 Restricted access. Purchase an OG Pass first!",
        ephemeral: true,
      });
    }

    if (activeBlackjack.has(userId) && !repeatAmount) {
      return interaction.reply({
        content: "❌ You already have a game in progress!",
        ephemeral: true,
      });
    }

    // Safety Deferral
    if (!interaction.deferred && !interaction.replied)
      await interaction.deferReply();
    activeBlackjack.add(userId);

    try {
      // 2. Database & Balance Management
      let data = await PassUser.findOne({ userId });
      if (!data || data.passBalance < amount) {
        data = await PassUser.findOneAndUpdate(
          { userId },
          { $set: { passBalance: Math.max(data?.passBalance || 0, 50000) } },
          { upsert: true, new: true },
        );
      }

      data = await PassUser.findOneAndUpdate(
        { userId, passBalance: { $gte: amount } },
        { $inc: { passBalance: -amount } },
        { new: true },
      );

      // 3. Game Setup
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
      for (let i = 0; i < 4; i++)
        suits.forEach((s) => values.forEach((v) => deck.push(`${v}${s}`)));
      deck.sort(() => Math.random() - 0.5);

      let playerHand = [deck.pop(), deck.pop()];
      let dealerHand = [deck.pop(), deck.pop()];
      let totalPot = amount;
      let gameOver = false;

      const getVal = (hand) => {
        let total = 0,
          aces = 0;
        hand.forEach((c) => {
          const v = c.replace(/[^\dAJKQ]/g, "");
          if (v === "A") {
            aces++;
            total += 11;
          } else if (["J", "Q", "K"].includes(v)) total += 10;
          else total += parseInt(v);
        });
        while (total > 21 && aces > 0) {
          total -= 10;
          aces--;
        }
        return total;
      };

      const createEmbed = (
        status = "Make your move...",
        showDealer = false,
        color = 0x5865f2,
      ) => {
        return new EmbedBuilder()
          .setTitle("🎰 VIP BLACKJACK LOUNGE")
          .setColor(color)
          .setDescription(
            `**Current Status:**\n> ${status}\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬`,
          )
          .addFields(
            {
              name: "👤 YOUR HAND",
              value: `**${playerHand.join(" ")}**\nTotal: \`${getVal(playerHand)}\``,
              inline: true,
            },
            {
              name: "🏦 DEALER",
              value: showDealer
                ? `**${dealerHand.join(" ")}**\nTotal: \`${getVal(dealerHand)}\``
                : `**${dealerHand[0]}** 🎴`,
              inline: true,
            },
          )
          .setFooter({
            text: `💰 Active Stake: ${totalPot.toLocaleString()} gold`,
          });
      };

      // 4. Initial Blackjack Check (3:2 Payout)
      if (getVal(playerHand) === 21) {
        const dVal = getVal(dealerHand);
        const payout = dVal === 21 ? amount : Math.floor(amount * 2.5);
        await PassUser.updateOne({ userId }, { $inc: { passBalance: payout } });
        activeBlackjack.delete(userId);
        return interaction.editReply({
          embeds: [
            createEmbed(
              dVal === 21
                ? "🤝 **PUSH (Both have Blackjack)**"
                : "🔥 **NATURAL BLACKJACK!**",
              true,
              0x2ecc71,
            ),
          ],
          components: [],
        });
      }

      // 5. Main Game Loop
      let currentMsg = await interaction.editReply({
        embeds: [createEmbed()],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("hit")
              .setLabel("Hit")
              .setStyle(ButtonStyle.Primary)
              .setEmoji("➕"),
            new ButtonBuilder()
              .setCustomId("stand")
              .setLabel("Stand")
              .setStyle(ButtonStyle.Secondary)
              .setEmoji("✋"),
            new ButtonBuilder()
              .setCustomId("double")
              .setLabel("Double Down")
              .setStyle(ButtonStyle.Danger)
              .setEmoji("💰")
              .setDisabled(data.passBalance < amount),
          ),
        ],
      });

      const collector = currentMsg.createMessageComponentCollector({
        filter: (i) => i.user.id === userId,
        time: 30000,
      });

      collector.on("collect", async (i) => {
        try {
          if (i.customId === "double") {
            await PassUser.updateOne(
              { userId },
              { $inc: { passBalance: -amount } },
            );
            totalPot += amount;
            playerHand.push(deck.pop());
            return collector.stop("stand");
          }

          if (i.customId === "hit") {
            playerHand.push(deck.pop());
            if (getVal(playerHand) >= 21) return collector.stop("stand");

            await i.update({
              embeds: [createEmbed()],
              components: [
                new ActionRowBuilder().addComponents(
                  new ButtonBuilder()
                    .setCustomId("hit")
                    .setLabel("Hit")
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji("➕"),
                  new ButtonBuilder()
                    .setCustomId("stand")
                    .setLabel("Stand")
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji("✋"),
                ),
              ],
            });
          } else if (i.customId === "stand") {
            collector.stop("stand");
          }
        } catch (e) {
          collector.stop("error");
        }
      });

      collector.on("end", async (collected, reason) => {
        activeBlackjack.delete(userId);
        if (reason === "time")
          return interaction.editReply({
            content: "⌛ Game timed out.",
            components: [],
          });

        let dVal = getVal(dealerHand);
        const pVal = getVal(playerHand);

        // Dealer logic
        if (pVal <= 21) {
          while (dVal < 17) {
            dealerHand.push(deck.pop());
            dVal = getVal(dealerHand);
          }
        }

        let resultMsg = "";
        let finalPayout = 0;
        let finalColor = 0xe74c3c;

        if (pVal > 21) {
          resultMsg = "💀 **BUSTED!** You went over 21.";
        } else if (dVal > 21) {
          resultMsg = "🎉 **DEALER BUST!** You win!";
          finalPayout = totalPot * 2;
          finalColor = 0x2ecc71;
        } else if (pVal > dVal) {
          resultMsg = "✅ **YOU WIN!** Beat the dealer.";
          finalPayout = totalPot * 2;
          finalColor = 0x2ecc71;
        } else if (pVal === dVal) {
          resultMsg = "🤝 **PUSH!** Gold returned.";
          finalPayout = totalPot;
          finalColor = 0xf1c40f;
        } else {
          resultMsg = "❌ **HOUSE WINS!** Better luck next time.";
        }

        const updated = await PassUser.findOneAndUpdate(
          { userId },
          { $inc: { passBalance: finalPayout } },
          { new: true },
        );

        // Post-game UI
        const endRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("rep_bj")
            .setLabel("Play Again")
            .setStyle(ButtonStyle.Success)
            .setDisabled(updated.passBalance < amount),
          new ButtonBuilder()
            .setCustomId("quit_bj")
            .setLabel("Quit")
            .setStyle(ButtonStyle.Secondary),
        );

        const finalMsg = await interaction.editReply({
          embeds: [createEmbed(resultMsg, true, finalColor)],
          components: [endRow],
        });

        // Handle Play Again with a fresh collector to avoid "Interaction Failed"
        try {
          const nextAction = await finalMsg.awaitMessageComponent({
            filter: (b) => b.user.id === userId,
            time: 15000,
          });

          if (nextAction.customId === "rep_bj") {
            return module.exports.execute(nextAction, amount);
          } else {
            await nextAction.update({ components: [] });
          }
        } catch (e) {
          await interaction.editReply({ components: [] }).catch(() => null);
        }
      });
    } catch (err) {
      activeBlackjack.delete(userId);
      console.error(err);
    }
  },
};
