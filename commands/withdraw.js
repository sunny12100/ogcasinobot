const User = require("../models/User"); // Import your MongoDB model

module.exports = {
  name: "withdraw",
  async execute(interaction) {
    // 1. Defer because database lookups take a second
    await interaction.deferReply({ ephemeral: true });

    const amount = interaction.options.getInteger("amount");
    const customAccount = interaction.options.getString("account");

    // 2. Fetch User from MongoDB
    const userData = await User.findOne({ userId: interaction.user.id });

    // 3. Validation Checks
    if (!userData || !userData.verified) {
      return interaction.editReply("❌ You must be verified to withdraw gold.");
    }

    if (userData.gold < amount) {
      return interaction.editReply(
        `❌ Insufficient gold! You only have **${userData.gold.toLocaleString()}**.`,
      );
    }

    const target = customAccount || userData.ttio;

    // 4. Calculate Payout (5% fee in this version)
    const fee = Math.ceil(amount * 0.05);
    const finalAmount = amount - fee;

    // 5. Update Database Atomically
    userData.gold -= amount;
    await userData.save();

    // 6. Log for Admins
    const logChannelId = process.env.LOG_CHANNEL_ID;
    const logChannel = interaction.client.channels.cache.get(logChannelId);

    if (logChannel) {
      await logChannel.send({
        content:
          `🚨 **NEW WITHDRAWAL REQUEST**\n` +
          `👤 **User:** <@${interaction.user.id}>\n` +
          `💰 **Total:** ${amount.toLocaleString()}\n` +
          `📉 **Fee (5%):** -${fee.toLocaleString()}\n` +
          `🎁 **Payout:** **${finalAmount.toLocaleString()}**\n` +
          `🎮 **Destination Account:** \`${target}\``,
      });
    }

    // 7. Success Message
    await interaction.editReply(
      `✅ **Request Sent!** Deducted **${amount.toLocaleString()}** gold from your vault. You will receive **${finalAmount.toLocaleString()}** gold at \`${target}\` shortly.`,
    );
  },
};
