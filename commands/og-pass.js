const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const User = require("../models/User");
const PassUser = require("../models/PassUser"); // Ensure this path is correct
const { logToAudit } = require("../utils/logger");

const PASS_TIERS = {
  "2h": { price: 300, duration: 2 * 60 * 60 * 1000, label: "2 Hours" },
  "1d": { price: 600, duration: 24 * 60 * 60 * 1000, label: "1 Day" },
  "1w": { price: 1500, duration: 7 * 24 * 60 * 60 * 1000, label: "1 Week" },
  "1m": { price: 3000, duration: 30 * 24 * 60 * 60 * 1000, label: "1 Month" },
};

const PASS_ROLE_ID = "1483219208962834473";

module.exports = {
  data: new SlashCommandBuilder()
    .setName("og-pass")
    .setDescription("Purchase an OG Pass for VIP channel access")
    .addStringOption((option) =>
      option
        .setName("duration")
        .setDescription("How long do you want the pass for?")
        .setRequired(true)
        .addChoices(
          { name: "2 Hours (300 Gold)", value: "2h" },
          { name: "1 Day (600 Gold)", value: "1d" },
          { name: "1 Week (1.5k Gold)", value: "1w" },
          { name: "1 Month (3k Gold)", value: "1m" },
        ),
    ),

  async execute(interaction) {
    const tierKey = interaction.options.getString("duration");
    const tier = PASS_TIERS[tierKey];
    const userId = interaction.user.id;

    const user = await User.findOne({ userId });

    if (!user || user.gold < tier.price) {
      return interaction.reply({
        content: `❌ You need **${tier.price.toLocaleString()} Gold** for this pass!`,
        ephemeral: true,
      });
    }

    const initialBalance = user.gold;
    const now = Date.now();
    const currentExpiry =
      user.ogPassExpiry && user.ogPassExpiry > now
        ? user.ogPassExpiry.getTime()
        : now;
    const newExpiry = new Date(currentExpiry + tier.duration);

    // 1. Deduct Gold and Update Expiry
    const updatedUser = await User.findOneAndUpdate(
      { userId },
      {
        $inc: { gold: -tier.price },
        $set: { ogPassExpiry: newExpiry, hasOgPass: true },
      },
      { new: true },
    );

    // 2. INITIALIZE VIP WALLET (Fixes the "0 Gold" glitch)
    await PassUser.findOneAndUpdate(
      { userId },
      { $setOnInsert: { userId, passBalance: 1000000 } },
      { upsert: true, new: true },
    );

    const member = await interaction.guild.members.fetch(userId);
    await member.roles.add(PASS_ROLE_ID);

    const embed = new EmbedBuilder()
      .setTitle("🎟️ OG Pass Activated!")
      .setColor(0x00ff00)
      .setDescription(
        `You have purchased the **${tier.label}** pass.\nYour VIP Lounge wallet has been initialized with **1,000,000** gold!`,
      )
      .addFields(
        {
          name: "Cost",
          value: `${tier.price.toLocaleString()} Gold`,
          inline: true,
        },
        {
          name: "Expires",
          value: `<t:${Math.floor(newExpiry.getTime() / 1000)}:F>`,
          inline: true,
        },
      )
      .setFooter({ text: "Enjoy the VIP Lounge!" });

    await interaction.reply({ embeds: [embed] });

    try {
      await logToAudit(interaction.client, {
        userId,
        bet: tier.price,
        amount: -tier.price,
        oldBalance: initialBalance,
        newBalance: updatedUser.gold,
        reason: `OG Pass Purchase: ${tier.label}`,
      });
    } catch (e) {
      console.error(e);
    }
  },
};
