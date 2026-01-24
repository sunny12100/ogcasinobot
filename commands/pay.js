const { EmbedBuilder } = require("discord.js");
const { loadUsers, saveUsers } = require("../utils/db");
const { logToAudit } = require("../utils/logger");

module.exports = {
  name: "pay",
  async execute(interaction) {
    const target = interaction.options.getUser("user");
    const amount = interaction.options.getInteger("amount");
    const senderId = interaction.user.id;
    const receiverId = target.id;

    const users = loadUsers();

    // 1. Check if SENDER is verified
    if (!users[senderId]) {
      return interaction.reply({
        content:
          "❌ You are not verified! Please register in the casino-lobby first.",
        ephemeral: true,
      });
    }

    // 2. Check if RECEIVER is verified (Strict Verification)
    if (!users[receiverId]) {
      return interaction.reply({
        content: `❌ **Transfer Failed:** <@${receiverId}> is not a verified user. They must register before they can receive gold.`,
        ephemeral: true,
      });
    }

    // 3. Prevent paying yourself
    if (senderId === receiverId) {
      return interaction.reply({
        content: "🤨 You can't pay yourself, buddy. Nice try!",
        ephemeral: true,
      });
    }

    // 4. Check if sender has enough gold
    if (users[senderId].balance < amount) {
      return interaction.reply({
        content: `❌ You don't have enough gold! (Current Balance: \`${users[senderId].balance.toLocaleString()}\`)`,
        ephemeral: true,
      });
    }

    // --- EXECUTE TRANSFER ---
    users[senderId].balance -= amount;
    users[receiverId].balance += amount;
    saveUsers(users);

    // 5. Log to Audit Channel
    await logToAudit(interaction.client, {
      userId: receiverId, // The person getting the money
      adminId: senderId, // The person sending it (re-using adminId slot for sender)
      amount: amount,
      reason: `P2P Transfer from ${interaction.user.tag}`,
    });

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
          `🏦 **Your New Balance:** \`${users[senderId].balance.toLocaleString()}\` gold`,
      )
      .setTimestamp();

    await interaction.reply({ embeds: [successEmbed] });
  },
};
