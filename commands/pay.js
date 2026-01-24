const { EmbedBuilder } = require("discord.js");
const User = require("../models/User"); // Import your Mongoose model
const { logToAudit } = require("../utils/logger");

module.exports = {
  name: "pay",
  async execute(interaction) {
    const target = interaction.options.getUser("user");
    const amount = interaction.options.getInteger("amount");
    const senderId = interaction.user.id;
    const receiverId = target.id;

    // 1. Check if paying self or a bot
    if (senderId === receiverId) {
      return interaction.reply({
        content: "🤨 You can't pay yourself, buddy. Nice try!",
        ephemeral: true,
      });
    }

    if (target.bot) {
      return interaction.reply({
        content: "🤖 Bots don't need gold. They run on electricity!",
        ephemeral: true,
      });
    }

    if (amount <= 0) {
      return interaction.reply({
        content: "❌ You must send at least `1` gold.",
        ephemeral: true,
      });
    }

    // 2. Fetch both users from MongoDB
    const senderData = await User.findOne({ userId: senderId });
    const receiverData = await User.findOne({ userId: receiverId });

    // 3. Check sender verification
    if (!senderData) {
      return interaction.reply({
        content: "❌ You are not registered! Please register first.",
        ephemeral: true,
      });
    }

    // 4. Check receiver verification
    if (!receiverData) {
      return interaction.reply({
        content: `❌ **Transfer Failed:** ${target} is not a registered user. They must register before they can receive gold.`,
        ephemeral: true,
      });
    }

    // 5. Check sender balance
    if (senderData.gold < amount) {
      return interaction.reply({
        content: `❌ You don't have enough gold! (Current Balance: \`${senderData.gold.toLocaleString()}\`)`,
        ephemeral: true,
      });
    }

    // --- EXECUTE TRANSFER ---
    senderData.gold -= amount;
    receiverData.gold += amount;

    // Save both documents
    await senderData.save();
    await receiverData.save();

    // ✅ 6. Log to Audit Channel
    // We pass adminId as the sender so the log shows WHO moved the money
    await logToAudit(interaction.client, {
      userId: receiverId,
      adminId: senderId,
      amount: amount,
      reason: `P2P Transfer: ${interaction.user.tag} ➔ ${target.tag}`,
    }).catch((err) => console.error("Logger Error (Pay):", err));

    const successEmbed = new EmbedBuilder()
      .setTitle("💸 TRANSFER SUCCESSFUL")
      .setColor(0x5865f2)
      .setThumbnail(
        "https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExM2ppeDU1eXVxazEzNDU0ZGVycDJ3MnkyMm51empmMGF2OHE2YWthNyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/ZVr17jubM740M8tgkU/giphy.gif",
      )
      .setDescription(
        `✅ **Sent:** \`${amount.toLocaleString()}\` gold\n` +
          `👤 **From:** ${interaction.user}\n` +
          `👤 **To:** ${target}\n\n` +
          `🏦 **Your New Balance:** \`${senderData.gold.toLocaleString()}\` gold`,
      )
      .setTimestamp()
      .setFooter({ text: "Peer-to-Peer Transfer Complete" });

    await interaction.reply({ embeds: [successEmbed] });
  },
};
