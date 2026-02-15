const fetch = global.fetch || require("node-fetch");
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  PermissionFlagsBits,
} = require("discord.js");

let isTreasuryLocked = false;

/**
 * Robust Iterative Fetch with Retry, Timeout, and Backoff
 */
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
      ) {
        return response;
      }
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
    const VALID_CHANNEL_IDS = ["1435117294454833212", "1434947454289313902"];

    const DEPT_GAME_ID = process.env.TOTW_ACCOUNT_NAME;
    const DEPT_GAME_PASS = process.env.TOTW_ACCOUNT_PASS;
    const MAX_TRANSFER = 1500;
    const uid = interaction.id;

    // 1. DUAL PERMISSION CHECK
    if (!VALID_CHANNEL_IDS.includes(interaction.channelId)) {
      return interaction.reply({
        content: "❌ This command cannot be used here.",
        ephemeral: true,
      });
    }
    if (!interaction.member.roles.cache.has(DEPT_ROLE_ID)) {
      return interaction.reply({
        content: "❌ **Access Denied:** Missing TOTW role.",
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

    // --- RESTORED CONFIRMATION UI ---
    const confirmEmbed = new EmbedBuilder()
      .setTitle("📂 TOTW Bank: Pending Transfer")
      .setColor(0x2b2d31)
      .setDescription(
        `Authorizing transfer from **${DEPT_GAME_ID}** to **${targetID}**.`,
      )
      .addFields({
        name: "💰 Amount",
        value: `\`${amount.toLocaleString()}\` Gold`,
        inline: true,
      });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`confirm_${uid}`)
        .setLabel("Confirm & Send")
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
          content: "❌ **Transfer Cancelled by User.**",
          embeds: [],
          components: [],
        });
      }

      isTreasuryLocked = true;
      await i.deferUpdate();
      await interaction.editReply({
        content: "📡 **Processing TOTW Payout...**",
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

        // --- RESTORED LOG UI ---
        const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);
        if (logChannel?.isTextBased() && isSuccess) {
          const logEmbed = new EmbedBuilder()
            .setTitle("🏦 TOTW Treasury: Transaction Log")
            .setColor(0x3498db)
            .addFields(
              {
                name: "👤 Executed By",
                value: `${interaction.user.tag} (${interaction.user.id})`,
              },
              { name: "🎯 Recipient", value: `\`${targetID}\``, inline: true },
              {
                name: "💰 Amount",
                value: `\`${amount.toLocaleString()}\` Gold`,
                inline: true,
              },
              {
                name: "📂 Source Vault",
                value: `\`${DEPT_GAME_ID}\``,
                inline: true,
              },
            )
            .setTimestamp()
            .setFooter({ text: "TOTW Department Payout Log" });
          await logChannel.send({ embeds: [logEmbed] }).catch(() => null);
        }

        // Final Result Display
        const resultEmbed = new EmbedBuilder()
          .setTitle(isSuccess ? "✅ TOTW Payout Sent" : "⚠️ API Error")
          .setColor(isSuccess ? 0x2ecc71 : 0xe74c3c)
          .addFields(
            { name: "Recipient", value: `\`${targetID}\``, inline: true },
            { name: "Amount", value: `\`${amount}\``, inline: true },
            {
              name: "API Status",
              value: `\`${data.status || "Error"}\``,
              inline: true,
            },
          )
          .setFooter({ text: `Auth by: ${interaction.user.tag}` });

        await interaction.editReply({ content: null, embeds: [resultEmbed] });
        collector.stop("finished");
      } catch (err) {
        await interaction.editReply({
          content: `🚨 **Critical Error:** ${err.message}`,
        });
      } finally {
        isTreasuryLocked = false;
      }
    });

    collector.on("end", async (_, reason) => {
      if (reason === "time" && !isTreasuryLocked) {
        await interaction
          .editReply({
            content: "⌛ **Transaction Session Expired.**",
            components: [],
            embeds: [],
          })
          .catch(() => null);
      }
    });
  },
};
