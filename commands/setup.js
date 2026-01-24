const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} = require("discord.js");

module.exports = {
  name: "setup",
  async execute(interaction) {
    if (
      !interaction.member.permissions.has(PermissionFlagsBits.Administrator)
    ) {
      return interaction.reply({
        content: "❌ No permission.",
        ephemeral: true,
      });
    }

    // --- 1. REGISTRATION PANEL ---
    const regEmbed = new EmbedBuilder()
      .setTitle("✨ ＲＥＧＩＳＴＲＡＴＩＯＮ ＰＡＮＥＬ ✨")
      .setDescription(
        "# 🎮 Step 1: Link Account\n" +
          "Click the **Register** button below to link your Discord to your Territorial.io Account ID. \n\n" +
          "# 🛡️ Step 2: Verify & Deposit\n" +
          "To finish verification and add gold to your balance, send any amount to:\n" +
          "```AWwh_```\n" +
          "> **Note:** The bot scans for new transfers every 60 seconds. Your balance will update automatically once the transaction is detected.\n\n" +
          "### 📈 How to Update Balance\n" +
          "Need more gold? Simply send another transfer to **AWwh_**. You do **not** need to click register again. The system tracks your username and adds the gold to your existing wallet instantly.",
      )
      .setColor(0x2ecc71)
      .setFooter({ text: "System Status: 🟢 Online & Tracking" })
      .setTimestamp();

    const regRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("open_register_modal")
        .setLabel("Register")
        .setStyle(ButtonStyle.Success),
    );

    // --- 2. WITHDRAWAL PANEL ---
    const withdrawEmbed = new EmbedBuilder()
      .setTitle("💸 ＷＩＴＨＤＲＡＷＡＬ ＰＡＮＥＬ 💸")
      .setDescription(
        "# 📤 How to Withdraw\n" +
          "Click the **Withdraw** button below to start your payout request.\n\n" +
          "**1.** Enter the amount you wish to cash out.\n" +
          "**2.** Confirm the destination account (defaults to your linked Territorial Accound ID).\n" +
          "**3.** An admin will verify the request and send the gold in-game.\n\n" +
          "### 🧾 Transaction Details\n" +
          "> **Service Fee:** 3% is deducted from the total to cover transaction costs.\n" +
          "> **Example:** If you withdraw 1,000 gold, you will receive 970 gold.\n\n" +
          "# ⚠️ Important Note\n" +
          "Withdrawals are processed manually by staff. Please allow up to 24 hours for the gold to arrive. \n\n" +
          "**If you have not received your gold after 24 hours, please ping a <@930302959668056135> for assistance.**",
      )
      .setColor(0x3498db)
      .setFooter({
        text: "Please ensure your game account is not wrong before withdrawing.The Casino will not be responsible in that scenario.",
      });

    const withdrawRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("open_withdraw_modal")
        .setLabel("Withdraw")
        .setStyle(ButtonStyle.Primary),
    );

    // Send them as separate messages
    await interaction.channel.send({
      embeds: [regEmbed],
      components: [regRow],
    });
    await interaction.channel.send({
      embeds: [withdrawEmbed],
      components: [withdrawRow],
    });

    await interaction.reply({
      content: "✅ Panels created as separate messages!",
      ephemeral: true,
    });
  },
};
