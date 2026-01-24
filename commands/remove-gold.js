const { EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const { loadUsers, saveUsers } = require("../utils/db");
const { logToAudit } = require("../utils/logger");

module.exports = {
  name: "remove-gold",
  async execute(interaction) {
    const target = interaction.options.getUser("user");
    const amount = interaction.options.getInteger("amount");
    const users = loadUsers();

    // ERROR THROW: Check if user is verified/registered
    if (!users[target.id]) {
      return interaction.reply({
        content: `❌ **Error:** Cannot remove gold. <@${target.id}> does not have a verified casino account.`,
        ephemeral: true,
      });
    }

    const oldBalance = users[target.id].balance;
    users[target.id].balance = Math.max(0, users[target.id].balance - amount);
    const actualRemoved = oldBalance - users[target.id].balance;

    saveUsers(users);

    await logToAudit(interaction.client, {
      userId: target.id,
      adminId: interaction.user.id,
      amount: -actualRemoved,
      reason: "Admin remove-gold command",
    });

    const embed = new EmbedBuilder()
      .setTitle("💸 GOLD VOIDED")
      .setColor(0xe74c3c)
      .setDescription(`Removed gold from ${target}.`)
      .addFields(
        {
          name: "Amount Removed",
          value: `\`${actualRemoved.toLocaleString()}\` gold`,
          inline: true,
        },
        {
          name: "Current Balance",
          value: `\`${users[target.id].balance.toLocaleString()}\` gold`,
          inline: true,
        },
      );

    await interaction.reply({ embeds: [embed] });
  },
};
