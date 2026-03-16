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
  name: "vip-coinflip", // Distinct name to avoid conflict
  async execute(interaction, repeatAmount = null) {
    const userId = interaction.user.id;
    const amount = repeatAmount ?? interaction.options?.getInteger?.("amount");
    const LOUNGE_ROLE = "1483219208962834473";

    if (!interaction.member.roles.cache.has(LOUNGE_ROLE)) {
      return interaction.reply({
        content: "🚫 The VIP Coinflip is only for **OG Pass** holders!",
        ephemeral: true,
      });
    }

    if (!amount || amount <= 0 || amount > MAX_BET) {
      return interaction.reply({
        content: `❌ Invalid amount (1 - ${MAX_BET.toLocaleString()} Gold).`,
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

    let settled = false;
    let failSafe;

    try {
      let vipData = await PassUser.findOneAndUpdate(
        { userId, passBalance: { $gte: amount } },
        { $inc: { passBalance: -amount } },
        { new: true },
      );

      if (!vipData) {
        const check = await PassUser.findOne({ userId });
        return interaction.editReply({
          content: `❌ Not enough Practice Gold! Balance: \`${(check?.passBalance || 0).toLocaleString()}\``,
        });
      }

      activeCoinflip.add(userId);
      failSafe = setTimeout(() => activeCoinflip.delete(userId), 35000);

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
        .setTitle("🪙 VIP COINFLIP")
        .setColor(0x5865f2)
        .setDescription(
          `👤 **Player:** <@${userId}>\n💰 **Practice Bet:** \`${amount.toLocaleString()}\` gold\n\nPick a side! **50/50 Odds.**`,
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
        if (settled) return;
        settled = true;

        const choice = i.customId;

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
          try {
            const roll = randomFloat();
            const winChance = 0.5; // 50-50 odds for VIPs
            const won = roll < winChance;

            const resultSide = won
              ? choice
              : choice === "heads"
                ? "tails"
                : "heads";
            const payout = won ? amount * 2 : 0;
            const netChange = won ? amount : -amount;

            const updatedVip = await PassUser.findOneAndUpdate(
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

            const resultEmbed = new EmbedBuilder()
              .setTitle(won ? "🎉 VIP WIN!" : "💀 VIP LOSS")
              .setColor(won ? 0x2ecc71 : 0xe74c3c)
              .setDescription(
                `### Result: **${resultSide.toUpperCase()}**\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\nYou chose **${choice.toUpperCase()}**\n\n💰 **Net:** \`${netChange >= 0 ? "+" : ""}${netChange.toLocaleString()}\` Gold\n🏦 **Balance:** \`${updatedVip.passBalance.toLocaleString()}\``,
              );

            const repeatRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId("cf_rep")
                .setLabel("Flip Again")
                .setStyle(ButtonStyle.Success)
                .setDisabled(updatedVip.passBalance < amount),
              new ButtonBuilder()
                .setCustomId("cf_quit")
                .setLabel("Quit")
                .setStyle(ButtonStyle.Secondary),
            );

            await interaction.editReply({
              embeds: [resultEmbed],
              components: [repeatRow],
            });
          } catch (err) {
            console.error(err);
            await PassUser.updateOne(
              { userId },
              { $inc: { passBalance: amount } },
            );
          } finally {
            activeCoinflip.delete(userId);
            clearTimeout(failSafe);
          }
        }, 2000);
        collector.stop();
      });

      // Handle Repeat logic inside collector or via index.js interaction listener if preferred
    } catch (err) {
      activeCoinflip.delete(userId);
      console.error(err);
    }
  },
};
