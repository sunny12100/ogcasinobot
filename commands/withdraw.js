const { loadUsers, saveUsers } = require("../utils/db");

module.exports = {
  name: "withdraw",
  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const users = loadUsers();
    const amount = interaction.options.getInteger("amount");
    const userData = users[interaction.user.id];
    const target = interaction.options.getString("account") || userData?.ttio;

    if (!userData || !userData.verified)
      return interaction.editReply("❌ You must be verified.");
    if (userData.balance < amount)
      return interaction.editReply("❌ Not enough gold.");

    const fee = Math.ceil(amount * 0.05);
    userData.balance -= amount;
    saveUsers(users);

    const logChannel = interaction.client.channels.cache.get(
      process.env.LOG_CHANNEL_ID
    );
    if (logChannel) {
      logChannel.send(
        `🚨 **Withdrawal:** <@${interaction.user.id}> wants ${
          amount - fee
        } gold to **${target}**.`
      );
    }

    await interaction.editReply(
      `✅ Request sent! You will receive **${amount - fee}** gold.`
    );
  },
};
