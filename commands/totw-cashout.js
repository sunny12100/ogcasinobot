const fetch = global.fetch || require("node-fetch");
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  PermissionFlagsBits, // Added for visibility control
} = require("discord.js");

let isTreasuryLocked = false;

async function fetchWithRetry(url, options, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (
        response.ok ||
        (response.status >= 400 &&
          response.status < 500 &&
          response.status !== 429)
      )
        return response;
      if (attempt === retries) return response;
    } catch (err) {
      clearTimeout(timeoutId);
      if (attempt === retries) throw err;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

module.exports = {
  name: "totw-cashout",
  description: "TOTW Treasury: Send gold from the totw bank",
  // This line helps hide it from people without specific permissions in some setups
  default_member_permissions: PermissionFlagsBits.SendMessages,

  async execute(interaction) {
    if (!interaction.inGuild())
      return interaction.reply({
        content: "❌ Servers only.",
        ephemeral: true,
      });

    // --- CONFIGURATION ---
    const DEPT_ROLE_ID = "1434948030842405045";
    const LOG_CHANNEL_ID = "1472518058445635694";

    // Fix: Turned into an Array for multiple channel support
    const VALID_CHANNEL_IDS = ["1435117294454833212", "1434947454289313902"];

    const DEPT_GAME_ID = process.env.TOTW_ACCOUNT_NAME;
    const DEPT_GAME_PASS = process.env.TOTW_ACCOUNT_PASS;
    const MAX_TRANSFER = 1500;
    const uid = interaction.id;

    // 1. DUAL PERMISSION CHECK (Channel & Role)
    if (!VALID_CHANNEL_IDS.includes(interaction.channelId)) {
      return interaction.reply({
        content: `❌ This command cannot be used in this channel.`,
        ephemeral: true,
      });
    }

    if (!interaction.member.roles.cache.has(DEPT_ROLE_ID)) {
      return interaction.reply({
        content:
          "❌ **Access Denied:** You need the TOTW role to see/use this.",
        ephemeral: true,
      });
    }

    if (!DEPT_GAME_ID || !DEPT_GAME_PASS)
      return interaction.reply({
        content: "🚨 Config Error.",
        ephemeral: true,
      });
    if (isTreasuryLocked)
      return interaction.reply({ content: "⏳ System Busy.", ephemeral: true });

    // 2. VALIDATION
    const targetID = interaction.options
      .getString("account_id")
      ?.trim()
      .replace(/[^\w-]/g, "");
    const amount = interaction.options.getInteger("amount");

    if (
      !targetID ||
      targetID.length < 3 ||
      !Number.isInteger(amount) ||
      amount <= 0 ||
      amount > MAX_TRANSFER
    ) {
      return interaction.reply({
        content: "❌ Invalid Input.",
        ephemeral: true,
      });
    }

    // 3. UI & COLLECTOR
    const confirmEmbed = new EmbedBuilder()
      .setTitle("🏦 TOTW Treasury: Authorization")
      .setColor(0x2b2d31)
      .setDescription(`From \`${DEPT_GAME_ID}\` to \`${targetID}\``)
      .addFields({
        name: "💰 Amount",
        value: `\`${amount.toLocaleString()}\` Gold`,
      });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`confirm_${uid}`)
        .setLabel("Confirm")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`cancel_${uid}`)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary),
    );

    const response = await interaction.reply({
      embeds: [confirmEmbed],
      components: [row],
      fetchReply: true,
    });

    const collector = response.createMessageComponentCollector({
      filter: (i) =>
        i.user.id === interaction.user.id && i.customId.endsWith(uid),
      componentType: ComponentType.Button,
      time: 60000,
    });

    collector.on("collect", async (i) => {
      if (isTreasuryLocked)
        return i.reply({ content: "⚠️ System busy.", ephemeral: true });
      if (i.customId === `cancel_${uid}`) {
        collector.stop("cancelled");
        return i.update({
          content: "❌ **Aborted.**",
          embeds: [],
          components: [],
        });
      }

      isTreasuryLocked = true;
      await i.deferUpdate();
      await interaction.editReply({
        content: "📡 **Processing...**",
        components: [],
        embeds: [],
      });

      try {
        const apiResponse = await fetchWithRetry(
          "https://territorial.io/api/gold/send",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              account_name: DEPT_GAME_ID,
              password: DEPT_GAME_PASS,
              target_account_name: targetID,
              amount: amount,
            }),
          },
          1,
        );

        const data = await apiResponse
          .json()
          .catch(() => ({ status: "json_parse_error" }));
        const isSuccess = data.status === "ok" || data.status === "success";

        const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);
        if (logChannel?.isTextBased()) {
          const logEmbed = new EmbedBuilder()
            .setTitle(isSuccess ? "✅ Payout Success" : "🚨 Payout Failed")
            .setColor(isSuccess ? 0x2ecc71 : 0xe74c3c)
            .addFields(
              {
                name: "Staff",
                value: `<@${interaction.user.id}>`,
                inline: true,
              },
              { name: "Target", value: `\`${targetID}\``, inline: true },
              { name: "Amount", value: `\`${amount}\``, inline: true },
            )
            .setTimestamp();
          await logChannel.send({ embeds: [logEmbed] }).catch(() => null);
        }

        await interaction.editReply({
          content: isSuccess
            ? "✅ **Complete.**"
            : `❌ **Failed:** ${data.status}`,
        });
        collector.stop("finished");
      } catch (err) {
        await interaction.editReply({
          content: `🚨 **Error:** ${err.message}`,
        });
      } finally {
        isTreasuryLocked = false;
      }
    });

    collector.on("end", async (_, reason) => {
      if (reason === "time" && !isTreasuryLocked) {
        await interaction
          .editReply({ content: "⌛ **Expired.**", components: [], embeds: [] })
          .catch(() => null);
      }
    });
  },
};
