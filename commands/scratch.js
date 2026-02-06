const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  SlashCommandBuilder,
} = require("discord.js");

const User = require("../models/User");
const { logToAudit } = require("../utils/logger");

const activeScratch = new Map();
const SESSION_EXPIRY = 45000;

// Cleanup loop
setInterval(() => {
  const now = Date.now();
  for (const [id, ts] of activeScratch) {
    if (now - ts > SESSION_EXPIRY) activeScratch.delete(id);
  }
}, 30000);

module.exports = {
  data: new SlashCommandBuilder()
    .setName("scratch")
    .setDescription("Buy a scratch card")
    .addIntegerOption((opt) =>
      opt
        .setName("amount")
        .setDescription("Gold to bet (25–500)")
        .setRequired(true)
        .setMinValue(25)
        .setMaxValue(500),
    ),

  async execute(interaction) {
    const { user, options, client } = interaction;
    const amount = options.getInteger("amount");

    let replied = false;

    try {
      // ✅ ALWAYS defer first
      await interaction.deferReply();
      replied = true;

      // Lock check
      if (activeScratch.has(user.id)) {
        return interaction.editReply(
          "❌ You already have an scratch card open.",
        );
      }

      activeScratch.set(user.id, Date.now());

      // Atomic deduction
      const deductedUser = await User.findOneAndUpdate(
        { userId: user.id, gold: { $gte: amount } },
        { $inc: { gold: -amount } },
        { new: true },
      );

      if (!deductedUser) {
        activeScratch.delete(user.id);
        return interaction.editReply("❌ Not enough gold!");
      }

      // Grid generator
      const getGrid = (revealed = null, emoji = null) => {
        const rows = [];

        for (let i = 0; i < 5; i++) {
          const row = new ActionRowBuilder();

          for (let j = 0; j < 5; j++) {
            const id = `scr_${i}_${j}`;

            const btn = new ButtonBuilder()
              .setCustomId(id)
              .setLabel(revealed === id ? emoji : "?")
              .setStyle(
                revealed === id
                  ? emoji === "❌"
                    ? ButtonStyle.Danger
                    : ButtonStyle.Success
                  : ButtonStyle.Secondary,
              )
              .setDisabled(revealed !== null);

            row.addComponents(btn);
          }

          rows.push(row);
        }

        return rows;
      };

      const embed = new EmbedBuilder()
        .setTitle("🎫 Scratch Card")
        .setDescription("Pick a tile!")
        .addFields({
          name: "Balance",
          value: `${deductedUser.gold} gold`,
        });

      const msg = await interaction.editReply({
        embeds: [embed],
        components: getGrid(),
      });

      const collector = msg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: SESSION_EXPIRY,
      });

      collector.on("collect", async (i) => {
        if (i.user.id !== user.id) {
          return i.reply({
            content: "Not your game.",
            ephemeral: true,
          });
        }

        collector.stop("done");

        let settled = false;

        try {
          const rng = Math.random();
          const win = rng < 0.3;
          const mult = win ? 2 : 0;
          const emoji = win ? "🎫" : "❌";

          const payout = amount * mult;
          const net = payout - amount;

          const finalUser = await User.findOneAndUpdate(
            { userId: user.id },
            { $inc: { gold: payout } },
            { new: true },
          );

          settled = true;

          const result = new EmbedBuilder()
            .setTitle(win ? "You win!" : "You lose!")
            .addFields(
              {
                name: "Result",
                value: `Profit: ${net}`,
              },
              {
                name: "Balance",
                value: `${finalUser.gold}`,
              },
            );

          try {
            await i.update({
              embeds: [result],
              components: getGrid(i.customId, emoji),
            });
          } catch {}

          logToAudit(client, {
            userId: user.id,
            bet: amount,
            amount: net,
            oldBalance: deductedUser.gold,
            newBalance: finalUser.gold,
            reason: "Scratch result",
          });
        } catch (err) {
          console.error(err);

          if (!settled) {
            await User.updateOne(
              { userId: user.id },
              { $inc: { gold: amount } },
            );
          }

          try {
            await i.followUp({
              content: "❌ Error. Bet refunded.",
              ephemeral: true,
            });
          } catch {}
        } finally {
          activeScratch.delete(user.id);
        }
      });

      collector.on("end", async (_, reason) => {
        if (reason === "time") {
          activeScratch.delete(user.id);

          try {
            await User.updateOne(
              { userId: user.id },
              { $inc: { gold: amount } },
            );

            await interaction.editReply({
              content: "⏱️ Card expired. Refunded.",
              components: [],
            });
          } catch {}
        }
      });
    } catch (fatal) {
      console.error("Fatal scratch error:", fatal);

      activeScratch.delete(user.id);

      try {
        if (!replied) {
          await interaction.reply("❌ Command failed.");
        } else {
          await interaction.editReply("❌ Something went wrong.");
        }
      } catch {}
    }
  },
};
