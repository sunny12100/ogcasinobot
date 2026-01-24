const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const { logToAudit } = require("../utils/logger");
const { loadUsers, saveUsers } = require("../utils/db");

module.exports = {
  name: "rps", // This is the key that matches your index.js loader
  async execute(interaction, repeatAmount = null) {
    const amount = repeatAmount ?? interaction.options.getInteger("amount");
    const challengerId = interaction.user.id;
    const opponent = interaction.options.getUser("opponent");

    // 1. DATABASE & VERIFICATION CHECKS
    const users = loadUsers();

    // Check Challenger
    if (!users[challengerId] || !users[challengerId].verified) {
      return interaction.reply({
        content:
          "❌ You are not verified! Please register and verify in the casino-lobby first.",
        ephemeral: true,
      });
    }

    // Check Opponent
    if (!opponent || !users[opponent.id] || !users[opponent.id].verified) {
      return interaction.reply({
        content: "❌ Your opponent is not a verified player!",
        ephemeral: true,
      });
    }

    // Logic Checks
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
    if (users[challengerId].balance < amount) {
      return interaction.reply({
        content: `❌ You don't have enough gold! Balance: \`${users[challengerId].balance.toLocaleString()}\``,
        ephemeral: true,
      });
    }
    if (users[opponent.id].balance < amount) {
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

    // Invite Collector (Only the opponent can answer)
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
            `*Select your move below! Your choice will remain hidden until both players have picked.*`,
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
          return bi.reply({
            content: "You already locked in your move!",
            ephemeral: true,
          });
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
        let winnerId = null;

        if (p1 === p2) {
          winnerId = "tie";
        } else if (
          (p1 === "rock" && p2 === "scissors") ||
          (p1 === "paper" && p2 === "rock") ||
          (p1 === "scissors" && p2 === "paper")
        ) {
          winnerId = challengerId;
        } else {
          winnerId = opponent.id;
        }

        const freshUsers = loadUsers();
        let resultText = "";

        if (winnerId === "tie") {
          resultText = "🤝 **IT'S A DRAW!** No gold was exchanged.";
        } else {
          const loserId =
            winnerId === challengerId ? opponent.id : challengerId;

          // Move the gold
          freshUsers[winnerId].balance += amount;
          freshUsers[loserId].balance -= amount;
          saveUsers(freshUsers);

          resultText = `🏆 <@${winnerId}> **WON!**\n💰 They won **${amount.toLocaleString()}** gold from <@${loserId}>!`;

          // Log to Audit (Matches your logger structure)
          await logToAudit(interaction.client, {
            userId: winnerId,
            amount: amount,
            reason: `Won RPS PVP vs ${loserId}`,
          });
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

        // Clear buttons and update with results
        await interaction.editReply({
          content: " ",
          embeds: [finalEmbed],
          components: [],
        });
      });
    });
  },
};
