const User = require("../models/User"); // Import the Mongoose model

module.exports = {
  name: "register",
  async execute(interaction) {
    const ttioName = interaction.options.getString("username");
    const now = Date.now();

    try {
      // MONGODB: Find the user by ID.
      // If they exist, update ttio name. If not, create them (upsert).
      await User.findOneAndUpdate(
        { userId: interaction.user.id },
        {
          ttio: ttioName,
          // We don't touch 'gold' or 'verified' here so we don't reset their progress
          registeredAt: now,
        },
        { upsert: true, new: true },
      );

      await interaction.reply({
        content: `✅ Registered as **${ttioName}**. Send gold to **AWwh_** in-game to verify your account!`,
        ephemeral: true,
      });
    } catch (error) {
      console.error("Registration Error:", error);
      await interaction.reply({
        content:
          "❌ There was an error saving your registration. Please try again later.",
        ephemeral: true,
      });
    }
  },
};
