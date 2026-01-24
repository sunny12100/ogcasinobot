const { loadUsers, saveUsers } = require("../utils/db");

module.exports = {
  name: "register",
  async execute(interaction) {
    const users = loadUsers();
    const ttioName = interaction.options.getString("username");
    const now = Date.now();

    users[interaction.user.id] = {
      ttio: ttioName,
      verified: false,
      balance: users[interaction.user.id]?.balance || 0,
      registered_at: now,
      latest_tx_time: now,
    };

    saveUsers(users);
    await interaction.reply({
      content: `✅ Registered as **${ttioName}**. Send gold to **XZZWE** to verify!`,
      ephemeral: true,
    });
  },
};
