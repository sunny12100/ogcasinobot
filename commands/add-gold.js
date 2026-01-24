const { EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const { loadUsers, saveUsers } = require("../utils/db");
const { logToAudit } = require("../utils/logger");

module.exports = {
  name: "add-gold",
  async execute(interaction) {
    const target = interaction.options.getUser("user");
    const amount = interaction.options.getInteger("amount");
    const users = loadUsers();

    // ERROR THROW: Check if user is verified/registered
    if (!users[target.id]) {
      return interaction.reply({
        content: `❌ **Error:** <@${target.id}> is not a verified user. They must click the **Register** button in the casino-lobby before you can add gold to their account.`,
        ephemeral: true,
      });
    }

    users[target.id].balance += amount;
    saveUsers(users);

    await logToAudit(interaction.client, {
      userId: target.id,
      adminId: interaction.user.id,
      amount: amount,
      reason: "Admin add-gold command",
    });

    const embed = new EmbedBuilder()
      .setTitle("💰 GOLD GRANTED")
      .setColor(0x2ecc71)
      .setDescription(
        `Successfully added \`${amount.toLocaleString()}\` gold to ${target}.`,
      )
      .addFields({
        name: "New Balance",
        value: `\`${users[target.id].balance.toLocaleString()}\` gold`,
      });

    await interaction.reply({ embeds: [embed] });
  },
};
