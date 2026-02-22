const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");
const Trigger = require("../models/Trigger");

// Import the cache refresher from index.js
const { updateTriggerCache } = require("../utils/triggerHelper");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("autoreact")
    .setDescription("Manage automatic emoji reactions")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Add a new keyword trigger")
        .addStringOption((opt) =>
          opt
            .setName("keyword")
            .setDescription("The word to watch for")
            .setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName("emoji")
            .setDescription("The emoji or Emoji ID")
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Remove a keyword trigger")
        .addStringOption((opt) =>
          opt
            .setName("keyword")
            .setDescription("The keyword to delete")
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName("list").setDescription("Show all registered triggers"),
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "add") {
      const keyword = interaction.options.getString("keyword").toLowerCase();
      let emojiInput = interaction.options.getString("emoji");

      // Parse custom emoji ID if provided
      const customEmojiMatch = emojiInput.match(/<?a?:\w+:(\d+)>?/);
      const emoji = customEmojiMatch ? customEmojiMatch[1] : emojiInput;

      await Trigger.findOneAndUpdate(
        { keyword },
        { emojiId: emoji },
        { upsert: true },
      );

      await updateTriggerCache();

      return interaction.reply({
        content: `✅ Registered: Whenever someone says **${keyword}**, I will react with ${emojiInput}`,
        flags: [MessageFlags.Ephemeral],
      });
    }

    if (subcommand === "remove") {
      const inputKeyword = interaction.options.getString("keyword").trim();

      // 1. Try to find and delete the keyword (Case-Insensitive)
      const result = await Trigger.findOneAndDelete({
        keyword: { $regex: new RegExp(`^${inputKeyword}$`, "i") },
      });

      // 2. Check if we actually found something to delete
      if (!result) {
        return interaction.reply({
          content: `❌ Keyword \`${inputKeyword}\` was not found in the database.`,
          flags: [MessageFlags.Ephemeral],
        });
      }

      // 3. SUCCESS: If we reached here, the result was found and deleted
      await updateTriggerCache();

      return interaction.reply({
        content: `🗑️ **Successfully removed trigger:** \`${result.keyword}\``,
        flags: [MessageFlags.Ephemeral],
      });
    }
    if (subcommand === "list") {
      const triggers = await Trigger.find();
      if (triggers.length === 0) {
        return interaction.reply({
          content: "No triggers registered.",
          flags: [MessageFlags.Ephemeral],
        });
      }

      const list = triggers
        .map((t) => `• **${t.keyword}** → ${t.emojiId}`)
        .join("\n");

      const embed = new EmbedBuilder()
        .setTitle("🎰 OG Casino | Auto-Reaction Triggers")
        .setColor(0xf1c40f)
        .setDescription(list)
        .setFooter({ text: "Triggers are case-insensitive and live-synced." });

      return interaction.reply({ embeds: [embed] });
    }
  },
};
