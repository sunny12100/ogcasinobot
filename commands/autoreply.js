const { SlashCommandBuilder, MessageFlags } = require("discord.js");

const ReplyTrigger = require("../models/ReplyTrigger");
const { updateReplyCache } = require("../utils/replyTriggerHelper");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("autoreply")
    .setDescription("Manage auto replies")
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .addStringOption((opt) => opt.setName("keyword").setRequired(true))
        .addStringOption((opt) => opt.setName("response").setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .addStringOption((opt) => opt.setName("keyword").setRequired(true)),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === "add") {
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
        content: `✅ Reply set for **${keyword}**`,
        flags: [MessageFlags.Ephemeral],
      });
    }

    if (sub === "remove") {
      const keyword = interaction.options.getString("keyword");

      await ReplyTrigger.deleteOne({ keyword });

      await updateReplyCache();

      return interaction.reply({
        content: `🗑️ Removed reply for **${keyword}**`,
        flags: [MessageFlags.Ephemeral],
      });
    }
  },
};
