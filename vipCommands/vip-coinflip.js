const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const PassUser = require("../models/PassUser");
const crypto = require("crypto");

const activeCoinflip = new Set();
const MAX_BET = 5000;

function randomFloat() {
  return crypto.randomBytes(4).readUInt32BE() / 2 ** 32;
}

module.exports = {
  name: "vip-coinflip",
  async execute(interaction, repeatAmount = null) {
    const userId = interaction.user.id;
    const amount = repeatAmount ?? interaction.options?.getInteger?.("amount");
    const LOUNGE_ROLE = "1483219208962834473";

    if (!interaction.member.roles.cache.has(LOUNGE_ROLE)) {
      return interaction.reply({
        content: "🚫 This command is restricted.",
        ephemeral: true,
      });
    }

    if (!amount || amount <= 0 || amount > MAX_BET) {
      return interaction.reply({
        content: `❌ Bet must be between 1 and ${MAX_BET.toLocaleString()}.`,
        ephemeral: true,
      });
    }

    if (activeCoinflip.has(userId)) {
      return interaction.reply({
        content: "❌ You already have a coin in the air!",
        ephemeral: true,
      });
    }

    if (!interaction.deferred && !interaction.replied)
      await interaction.deferReply();

    try {
      // 1. Ensure user exists and get balance
      let data = await PassUser.findOneAndUpdate(
        { userId },
        { $setOnInsert: { userId } },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      );

      if (data.passBalance < amount) {
        return interaction.editReply({
          content: `❌ Insufficient balance! Current: \`${data.passBalance.toLocaleString()}\``,
        });
      }

      // 2. Deduct
      data = await PassUser.findOneAndUpdate(
        { userId, passBalance: { $gte: amount } },
        { $inc: { passBalance: -amount } },
        { new: true },
      );

      activeCoinflip.add(userId);
      const failSafe = setTimeout(() => activeCoinflip.delete(userId), 35000);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("heads")
          .setLabel("Heads")
          .setStyle(ButtonStyle.Primary)
          .setEmoji("🪙"),
        new ButtonBuilder()
          .setCustomId("tails")
          .setLabel("Tails")
          .setStyle(ButtonStyle.Secondary)
          .setEmoji("🦅"),
      );

      const initialEmbed = new EmbedBuilder()
        .setTitle("🪙 COINFLIP")
        .setColor(0x5865f2)
        .setDescription(
          `👤 **Player:** <@${userId}>\n💰 **Bet:** \`${amount.toLocaleString()}\` gold\n\nPick a side to double your bet!`,
        );

      const msg = await interaction.editReply({
        embeds: [initialEmbed],
        components: [row],
      });
      const collector = msg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 20000,
      });

      collector.on("collect", async (i) => {
        if (i.user.id !== userId)
          return i.reply({ content: "Not your game!", ephemeral: true });
        collector.stop();

        await i.update({
          embeds: [
            new EmbedBuilder()
              .setTitle("🪙 FLIPPING...")
              .setColor(0xffaa00)
              .setImage(
                "https://media0.giphy.com/media/v1.Y2lkPTc5MGI3NjExY3NyOHdrYmsydDhoNXN2cGNxajl2cnVqNmN2enBscm1oZHJuZHg4eCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/6jqfXikz9yzhS/giphy.gif",
              ),
          ],
          components: [],
        });

        setTimeout(async () => {
          const won = randomFloat() < 0.5;
          const resultSide = won
            ? i.customId
            : i.customId === "heads"
              ? "tails"
              : "heads";
          const payout = won ? amount * 2 : 0;

          let updated = await PassUser.findOneAndUpdate(
            { userId },
            {
              $inc: {
                passBalance: payout,
                totalWagered: amount,
                totalWon: won ? amount : 0,
                totalLost: won ? 0 : amount,
                gamesPlayed: 1,
              },
            },
            { new: true },
          );

          // Pity Reload logic (hidden in description)
          let statusText = "";
          if (updated.passBalance < 1) {
            updated = await PassUser.findOneAndUpdate(
              { userId },
              { $set: { passBalance: 50000 } },
              { new: true },
            );
            statusText = "\n\n*Reloaded 50,000 gold (Bust protection).*";
          }

          const resultEmbed = new EmbedBuilder()
            .setTitle(won ? "🎉 WINNER!" : "💀 LOST")
            .setColor(won ? 0x2ecc71 : 0xe74c3c)
            .setDescription(
              `### The coin landed on: **${resultSide.toUpperCase()}**\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n💰 **Change:** \`${won ? "+" : "-"}${amount.toLocaleString()}\` gold\n🏦 **Balance:** \`${updated.passBalance.toLocaleString()}\` gold${statusText}`,
            );

          const repeatRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("cf_rep")
              .setLabel("Flip Again")
              .setStyle(ButtonStyle.Success)
              .setDisabled(updated.passBalance < amount),
            new ButtonBuilder()
              .setCustomId("cf_quit")
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

          endCollector.on("collect", async (btn) => {
            if (btn.user.id !== userId) return;
            activeCoinflip.delete(userId);
            clearTimeout(failSafe);
            if (btn.customId === "cf_rep") {
              await btn.deferUpdate();
              return module.exports.execute(btn, amount);
            }
            await btn.update({ components: [] });
          });

          activeCoinflip.delete(userId);
          clearTimeout(failSafe);
        }, 2000);
      });
    } catch (err) {
      activeCoinflip.delete(userId);
      console.error(err);
    }
  },
};
