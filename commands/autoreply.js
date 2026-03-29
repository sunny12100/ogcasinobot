const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");

const ReplyTrigger = require("../models/ReplyTrigger");
const { updateReplyCache } = require("../utils/replyTriggerHelper");

const CASINO_MANAGER_ROLE = "1475908523396300871";

module.exports = {
  data: new SlashCommandBuilder()
    .setName("autoreply")
    .setDescription("Manage automatic replies")
    .setDefaultMemberPermissions(0)
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Add a reply trigger")
        .addStringOption((opt) =>
          opt
            .setName("keyword")
            .setDescription("Exact word trigger")
            .setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName("response")
            .setDescription("Reply message")
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Remove a reply trigger")
        .addStringOption((opt) =>
          opt
            .setName("keyword")
            .setDescription("Keyword to delete")
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName("list").setDescription("Show all reply triggers"),
    ),

  async execute(interaction) {
    // 🔐 SAME ROLE CHECK AS AUTOREACT
    if (!interaction.member.roles.cache.has(CASINO_MANAGER_ROLE)) {
      return interaction.reply({
        content: "❌ Only Casino Managers can use this command.",
        flags: [MessageFlags.Ephemeral],
      });
    }

    const subcommand = interaction.options.getSubcommand();

    // ================= ADD =================
    if (subcommand === "add") {
      const keyword = interaction.options
        .getString("keyword")
        .toLowerCase()
        .trim();

      const response = interaction.options.getString("response");

      await ReplyTrigger.findOneAndUpdate(
        { keyword },
        { response },
        { upsert: true },
      );

      await updateReplyCache();

      return interaction.reply({
        content: `✅ Registered: When someone says **${keyword}**, I will reply:\n> ${response}`,
        flags: [MessageFlags.Ephemeral],
      });
    }

    // ================= REMOVE =================
    if (subcommand === "remove") {
      const inputKeyword = interaction.options.getString("keyword").trim();

      const result = await ReplyTrigger.findOneAndDelete({
        keyword: { $regex: new RegExp(`^${inputKeyword}$`, "i") },
      });

      if (!result) {
        return interaction.reply({
          content: `❌ Keyword \`${inputKeyword}\` not found.`,
          flags: [MessageFlags.Ephemeral],
        });
      }

      await updateReplyCache();

      return interaction.reply({
        content: `🗑️ Removed reply trigger: \`${result.keyword}\``,
        flags: [MessageFlags.Ephemeral],
      });
    }

    // ================= LIST =================
    if (subcommand === "list") {
      const triggers = await ReplyTrigger.find();

      if (!triggers.length) {
        return interaction.reply({
          content: "📭 No reply triggers set.",
          flags: [MessageFlags.Ephemeral],
        });
      }

      const list = triggers
        .map((t) => `• **${t.keyword}** → ${t.response}`)
        .join("\n");

      const embed = new EmbedBuilder()
        .setTitle("💬 OG Casino | Auto-Reply Triggers")
        .setColor(0x3498db)
        .setDescription(list)
        .setFooter({ text: "Exact match only (case-insensitive)." });

      return interaction.reply({ embeds: [embed] });
    }
  },
};
