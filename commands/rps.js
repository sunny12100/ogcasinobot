const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const User = require("../models/User"); // Import Mongoose model
const { logToAudit } = require("../utils/logger");

module.exports = {
  name: "rps",
  async execute(interaction, repeatAmount = null) {
    const amount = repeatAmount ?? interaction.options.getInteger("amount");
    const challengerId = interaction.user.id;
    const opponent = interaction.options.getUser("opponent");

    // 1. DATABASE & VERIFICATION CHECKS
    const challengerData = await User.findOne({ userId: challengerId });
    const opponentData = await User.findOne({ userId: opponent?.id });

    // Check Challenger registration
    if (!challengerData) {
      return interaction.reply({
        content:
          "❌ You are not registered! Please register in the casino-lobby first.",
        ephemeral: true,
      });
    }

    // Check Opponent registration
    if (!opponentData) {
      return interaction.reply({
        content: "❌ Your opponent is not a registered player!",
        ephemeral: true,
      });
    }

    // Validation: Self and Bots
    if (opponent.id === challengerId) {
      return interaction.reply({
        content: "❌ You cannot challenge yourself!",
        ephemeral: true,
      });
    }

    if (opponent.bot) {
      return interaction.reply({
        content: "❌ You cannot challenge bots!",
        ephemeral: true,
      });
    }

    // Balance Checks
    if (challengerData.gold < amount) {
      return interaction.reply({
        content: `❌ You don't have enough gold! Balance: \`${challengerData.gold.toLocaleString()}\``,
        ephemeral: true,
      });
    }
    if (opponentData.gold < amount) {
      return interaction.reply({
        content: `❌ Your opponent doesn't have enough gold for this bet!`,
        ephemeral: true,
      });
    }

    // 2. THE CHALLENGE INVITE
    const inviteEmbed = new EmbedBuilder()
      .setTitle("⚔️ RPS PVP CHALLENGE")
      .setColor(0x5865f2)
      .setDescription(
        `<@${challengerId}> has challenged <@${opponent.id}> for **${amount.toLocaleString()}** gold!\n\n` +
          `*Waiting for <@${opponent.id}> to accept...*`,
      )
      .setFooter({ text: "Expires in 30 seconds" });

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
    });

    inviteCollector.on("collect", async (i) => {
      if (i.customId === "rps_decline") {
        return i.update({
          content: "❌ Challenge declined.",
          embeds: [],
          components: [],
        });
      }

      // 3. SELECTION PHASE
      inviteCollector.stop();

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

      const gameEmbed = new EmbedBuilder()
        .setTitle("🪨📄✂️ SELECTION PHASE")
        .setColor(0xffaa00)
        .setDescription(
          `**Bet:** \`${amount.toLocaleString()}\` gold\n` +
            `**Players:** <@${challengerId}> vs <@${opponent.id}>\n\n` +
            `*Select your move! Choices are hidden until both players pick.*`,
        );

      await i.update({
        content: "The duel is live!",
        embeds: [gameEmbed],
        components: [gameRow],
      });

      const choices = {};
      const gameCollector = response.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 60000,
      });

      gameCollector.on("collect", async (bi) => {
        if (bi.user.id !== challengerId && bi.user.id !== opponent.id) {
          return bi.reply({
            content: "This isn't your game!",
            ephemeral: true,
          });
        }
        if (choices[bi.user.id]) {
          return bi.reply({ content: "You already picked!", ephemeral: true });
        }

        choices[bi.user.id] = bi.customId;
        await bi.reply({
          content: `✅ You picked **${bi.customId.toUpperCase()}**!`,
          ephemeral: true,
        });

        if (choices[challengerId] && choices[opponent.id]) {
          gameCollector.stop("finished");
        }
      });

      gameCollector.on("end", async (collected, reason) => {
        if (reason !== "finished") {
          return interaction.editReply({
            content: "❌ Duel cancelled: Someone didn't pick in time.",
            embeds: [],
            components: [],
          });
        }

        // 4. RESOLUTION
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

        let resultText = "";

        if (winnerId === "tie") {
          resultText = "🤝 **IT'S A DRAW!** No gold was exchanged.";
        } else {
          const loserId =
            winnerId === challengerId ? opponent.id : challengerId;

          // FETCH FRESH DATA: Prevent gold dupe/spending glitches during the 60s window
          const winUser = await User.findOne({ userId: winnerId });
          const loseUser = await User.findOne({ userId: loserId });

          // Final balance validation
          if (loseUser.gold < amount) {
            return interaction.editReply({
              content:
                "❌ Error: The loser no longer has enough gold to cover the bet!",
              embeds: [],
              components: [],
            });
          }

          winUser.gold += amount;
          loseUser.gold -= amount;

          await winUser.save();
          await loseUser.save();

          resultText = `🏆 <@${winnerId}> **WON!**\n💰 They won **${amount.toLocaleString()}** gold from <@${loserId}>!`;

          // ✅ LOG TO AUDIT
          await logToAudit(interaction.client, {
            userId: winnerId,
            adminId: loserId, // The "source" of the gold
            amount: amount,
            reason: `PVP RPS: ${winnerId} beat ${loserId} (${p1} vs ${p2})`,
          }).catch((err) => console.error("Logger Error (RPS):", err));
        }

        const finalEmbed = new EmbedBuilder()
          .setTitle("🏁 DUEL RESULTS")
          .setColor(winnerId === "tie" ? 0x95a5a6 : 0x2ecc71)
          .setDescription(
            `<@${challengerId}> chose: **${p1.toUpperCase()}**\n` +
              `<@${opponent.id}> chose: **${p2.toUpperCase()}**\n\n` +
              `${resultText}`,
          )
          .setTimestamp();

        await interaction.editReply({
          content: " ",
          embeds: [finalEmbed],
          components: [],
        });
      });
    });
  },
};
