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
        content: "🚫 Restricted access.",
        ephemeral: true,
      });
    }

    if (!amount || amount <= 0 || amount > MAX_BET) {
      const msg = `❌ Bet must be 1 - ${MAX_BET.toLocaleString()}.`;
      return interaction.replied
        ? interaction.followUp({ content: msg, ephemeral: true })
        : interaction.reply({ content: msg, ephemeral: true });
    }

    if (activeCoinflip.has(userId)) return;

    if (!interaction.deferred && !interaction.replied)
      await interaction.deferReply();

    activeCoinflip.add(userId);
    let failSafe = setTimeout(() => activeCoinflip.delete(userId), 30000);

    try {
      // Self-Healing Balance Check
      let data = await PassUser.findOne({ userId });
      if (!data) {
        data = await PassUser.create({ userId, passBalance: 1000000 });
      } else if (data.passBalance < amount) {
        if (data.passBalance <= 0) {
          data = await PassUser.findOneAndUpdate(
            { userId },
            { $set: { passBalance: 50000 } },
            { new: true },
          );
        } else {
          activeCoinflip.delete(userId);
          clearTimeout(failSafe);
          return interaction.editReply({
            content: `❌ Not enough gold! Balance: \`${data.passBalance.toLocaleString()}\``,
          });
        }
      }

      // Deduct
      data = await PassUser.findOneAndUpdate(
        { userId, passBalance: { $gte: amount } },
        { $inc: { passBalance: -amount } },
        { new: true },
      );

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

      const msg = await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("🪙 COINFLIP")
            .setColor(0x5865f2)
            .setDescription(
              `👤 <@${userId}>\n💰 **Bet:** \`${amount.toLocaleString()}\` gold\n\nPick a side!`,
            ),
        ],
        components: [row],
      });

      const choice = await msg
        .awaitMessageComponent({
          filter: (i) => i.user.id === userId,
          time: 20000,
        })
        .catch(() => null);

      if (!choice) {
        await PassUser.updateOne({ userId }, { $inc: { passBalance: amount } });
        activeCoinflip.delete(userId);
        return interaction.editReply({
          content: "⏲️ **Timed Out:** Refunded.",
          embeds: [],
          components: [],
        });
      }

      await choice.update({
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
          ? choice.customId
          : choice.customId === "heads"
            ? "tails"
            : "heads";

        let updated = await PassUser.findOneAndUpdate(
          { userId },
          {
            $inc: {
              passBalance: won ? amount * 2 : 0,
              totalWagered: amount,
              totalWon: won ? amount : 0,
              totalLost: won ? 0 : amount,
              gamesPlayed: 1,
            },
          },
          { new: true },
        );

        let reloadText = "";
        if (updated.passBalance < 1) {
          updated = await PassUser.findOneAndUpdate(
            { userId },
            { $set: { passBalance: 50000 } },
            { new: true },
          );
          reloadText = "\n\n*Reloaded 50,000 gold (Bust protection).*";
        }

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

        const resEmbed = new EmbedBuilder()
          .setTitle(won ? "🎉 WINNER!" : "💀 LOST")
          .setColor(won ? 0x2ecc71 : 0xe74c3c)
          .setDescription(
            `### Result: **${resultSide.toUpperCase()}**\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n💰 **Change:** \`${won ? "+" : "-"}${amount.toLocaleString()}\` gold\n🏦 **Balance:** \`${updated.passBalance.toLocaleString()}\` gold${reloadText}`,
          );

        const finalMsg = await interaction.editReply({
          embeds: [resEmbed],
          components: [repeatRow],
        });
        const next = await finalMsg
          .awaitMessageComponent({
            filter: (b) => b.user.id === userId,
            time: 15000,
          })
          .catch(() => null);

        activeCoinflip.delete(userId);
        clearTimeout(failSafe);

        if (next?.customId === "cf_rep") {
          await next.deferUpdate();
          return module.exports.execute(next, amount);
        }
        if (next) await next.update({ components: [] });
      }, 2000);
    } catch (err) {
      activeCoinflip.delete(userId);
      console.error(err);
    }
  },
};
