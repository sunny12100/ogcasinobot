const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const User = require("../models/User");
const { logToAudit } = require("../utils/logger");

// Prevents users from spamming multiple challenges at once
const activeGames = new Set();

module.exports = {
  name: "rps",
  async execute(interaction, repeatAmount = null) {
    const amount = repeatAmount ?? interaction.options.getInteger("amount");
    const challengerId = interaction.user.id;
    const opponent = interaction.options.getUser("opponent");

    // 1. INITIAL CHECKS
    if (activeGames.has(challengerId) || activeGames.has(opponent?.id)) {
      return interaction.reply({
        content: "❌ One of you is already in a game!",
        ephemeral: true,
      });
    }

    const challengerData = await User.findOne({ userId: challengerId });
    const opponentData = await User.findOne({ userId: opponent?.id });

    if (!challengerData || !opponentData) {
      return interaction.reply({
        content: "❌ One or both players are not registered!",
        ephemeral: true,
      });
    }
    if (opponent.id === challengerId || opponent.bot) {
      return interaction.reply({
        content: "❌ Invalid opponent!",
        ephemeral: true,
      });
    }
    if (challengerData.gold < amount || opponentData.gold < amount) {
      return interaction.reply({
        content: "❌ Someone is too poor for this bet!",
        ephemeral: true,
      });
    }

    activeGames.add(challengerId);
    activeGames.add(opponent.id);

    // 2. THE CHALLENGE INVITE
    const inviteEmbed = new EmbedBuilder()
      .setTitle("⚔️ RPS PVP CHALLENGE")
      .setColor(0x5865f2)
      .setDescription(
        `<@${challengerId}> challenged <@${opponent.id}> for **${amount.toLocaleString()}** gold!\n\n*Waiting for acceptance...*`,
      );

    const inviteRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("rps_accept")
        .setLabel("Accept Duel")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("rps_decline")
        .setLabel("Decline")
        .setStyle(ButtonStyle.Danger),
    );

    const response = await interaction.reply({
      content: `<@${opponent.id}>`,
      embeds: [inviteEmbed],
      components: [inviteRow],
      fetchReply: true,
    });

    const inviteCollector = response.createMessageComponentCollector({
      filter: (i) => i.user.id === opponent.id,
      time: 30000,
      max: 1, // Stop immediately after one choice
    });

    inviteCollector.on("collect", async (i) => {
      if (i.customId === "rps_decline") {
        activeGames.delete(challengerId);
        activeGames.delete(opponent.id);
        return i.update({
          content: "❌ Challenge declined.",
          embeds: [],
          components: [],
        });
      }

      // 3. SELECTION PHASE
      const gameRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("rock")
          .setLabel("Rock")
          .setEmoji("🪨")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("paper")
          .setLabel("Paper")
          .setEmoji("📄")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("scissors")
          .setLabel("Scissors")
          .setEmoji("✂️")
          .setStyle(ButtonStyle.Secondary),
      );

      await i.update({
        content: "The duel is live! Select your moves below.",
        embeds: [
          new EmbedBuilder()
            .setTitle("🪨📄✂️ SELECTION PHASE")
            .setColor(0xffaa00)
            .setDescription(
              `**Bet:** \`${amount.toLocaleString()}\` gold\n**Players:** <@${challengerId}> vs <@${opponent.id}>`,
            ),
        ],
        components: [gameRow],
      });

      const choices = {};
      const gameCollector = response.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 45000,
      });

      gameCollector.on("collect", async (bi) => {
        if (bi.user.id !== challengerId && bi.user.id !== opponent.id) {
          return bi.reply({ content: "Not your game!", ephemeral: true });
        }
        if (choices[bi.user.id])
          return bi.reply({ content: "Already picked!", ephemeral: true });

        choices[bi.user.id] = bi.customId;
        await bi.reply({
          content: `✅ You picked **${bi.customId.toUpperCase()}**!`,
          ephemeral: true,
        });

        if (choices[challengerId] && choices[opponent.id])
          gameCollector.stop("finished");
      });

      gameCollector.on("end", async (_, reason) => {
        activeGames.delete(challengerId);
        activeGames.delete(opponent.id);

        if (reason !== "finished") {
          return interaction.editReply({
            content: "❌ Duel timed out.",
            embeds: [],
            components: [],
          });
        }

        const p1 = choices[challengerId];
        const p2 = choices[opponent.id];

        let winnerId =
          p1 === p2
            ? "tie"
            : (p1 === "rock" && p2 === "scissors") ||
                (p1 === "paper" && p2 === "rock") ||
                (p1 === "scissors" && p2 === "paper")
              ? challengerId
              : opponent.id;

        if (winnerId === "tie") {
          return interaction.editReply({
            content: " ",
            embeds: [
              new EmbedBuilder()
                .setTitle("🤝 DRAW")
                .setDescription(
                  `<@${challengerId}> and <@${opponent.id}> both chose **${p1.toUpperCase()}**.`,
                ),
            ],
            components: [],
          });
        }

        const loserId = winnerId === challengerId ? opponent.id : challengerId;

        // 4. DATABASE UPDATES
        const winUser = await User.findOne({ userId: winnerId });
        const loseUser = await User.findOne({ userId: loserId });

        if (!loseUser || loseUser.gold < amount) {
          return interaction.editReply({
            content:
              "❌ Error: Winner takes nothing because the loser went broke during the game!",
            embeds: [],
            components: [],
          });
        }

        const oldWinBal = winUser.gold;
        const oldLoseBal = loseUser.gold;

        winUser.gold += amount;
        loseUser.gold -= amount;

        await winUser.save();
        await loseUser.save();

        // 5. LOGGING
        await logToAudit(interaction.client, {
          userId: winnerId,
          amount: amount,
          oldBalance: oldWinBal,
          newBalance: winUser.gold,
          reason: `PVP RPS Win vs ${loserId}`,
        }).catch(() => null);

        await logToAudit(interaction.client, {
          userId: loserId,
          amount: -amount,
          oldBalance: oldLoseBal,
          newBalance: loseUser.gold,
          reason: `PVP RPS Loss vs ${winnerId}`,
        }).catch(() => null);

        await interaction.editReply({
          content: " ",
          embeds: [
            new EmbedBuilder()
              .setTitle("🏁 DUEL RESULTS")
              .setColor(0x2ecc71)
              .setDescription(
                `<@${challengerId}>: **${p1.toUpperCase()}**\n<@${opponent.id}>: **${p2.toUpperCase()}**\n\n🏆 <@${winnerId}> **WON ${amount.toLocaleString()} gold!**`,
              ),
          ],
          components: [],
        });
      });
    });

    inviteCollector.on("end", (collected, reason) => {
      if (reason === "time" && collected.size === 0) {
        activeGames.delete(challengerId);
        activeGames.delete(opponent.id);
        interaction.editReply({
          content: "❌ Challenge expired: No response.",
          embeds: [],
          components: [],
        });
      }
    });
  },
};
