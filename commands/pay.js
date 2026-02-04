const { EmbedBuilder } = require("discord.js");
const User = require("../models/User");
const { logToAudit } = require("../utils/logger");

module.exports = {
  name: "pay",
  async execute(interaction) {
    const target = interaction.options.getUser("user");
    const amount = interaction.options.getInteger("amount");
    const senderId = interaction.user.id;
    const receiverId = target.id;

    if (senderId === receiverId) {
      return interaction.reply({
        content: "🤨 You can't pay yourself, buddy.",
        ephemeral: true,
      });
    }

    if (target.bot) {
      return interaction.reply({
        content: "🤖 Bots don't need gold!",
        ephemeral: true,
      });
    }

    if (amount <= 0) {
      return interaction.reply({
        content: "❌ You must send at least `1` gold.",
        ephemeral: true,
      });
    }

    try {
      // Fetch both users
      const senderData = await User.findOne({ userId: senderId });
      const receiverData = await User.findOne({ userId: receiverId });

      if (!senderData)
        return interaction.reply({
          content: "❌ You are not registered!",
          ephemeral: true,
        });
      if (!receiverData)
        return interaction.reply({
          content: `❌ **Transfer Failed:** ${target} is not registered.`,
          ephemeral: true,
        });

      if (senderData.gold < amount) {
        return interaction.reply({
          content: `❌ You don't have enough gold!`,
          ephemeral: true,
        });
      }

      // --- SNAPSHOTS FOR AUDIT ---
      const senderOldBalance = senderData.gold;
      const receiverOldBalance = receiverData.gold;

      // --- EXECUTE TRANSFER ---
      senderData.gold -= amount;
      receiverData.gold += amount;

      await senderData.save();
      await receiverData.save();

      // ✅ LOG FOR SENDER (The person who lost gold)
      await logToAudit(interaction.client, {
        userId: senderId,
        amount: -amount, // Negative because gold left
        oldBalance: senderOldBalance,
        newBalance: senderData.gold,
        reason: `P2P Transfer: Sent to ${target.tag}`,
      }).catch(() => null);

      // ✅ LOG FOR RECEIVER (The person who gained gold)
      await logToAudit(interaction.client, {
        userId: receiverId,
        amount: amount, // Positive because gold arrived
        oldBalance: receiverOldBalance,
        newBalance: receiverData.gold,
        reason: `P2P Transfer: Received from ${interaction.user.tag}`,
      }).catch(() => null);

      const successEmbed = new EmbedBuilder()
        .setTitle("💸 TRANSFER SUCCESSFUL")
        .setColor(0x5865f2)
        .setThumbnail(
          "https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExM2ppeDU1eXVxazEzNDU0ZGVycDJ3MnkyMm51empmMGF2OHE2YWthNyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/ZVr17jubM740M8tgkU/giphy.gif",
        )
        .setDescription(
          `✅ **Sent:** \`${amount.toLocaleString()}\` gold\n` +
            `👤 **To:** ${target}\n\n` +
            `🏦 **Your New Balance:** \`${senderData.gold.toLocaleString()}\` gold`,
        )
        .setTimestamp();

      await interaction.reply({ embeds: [successEmbed] });
    } catch (err) {
      console.error(err);
      interaction.reply({
        content: "❌ Internal error during transfer.",
        ephemeral: true,
      });
    }
  },
};
