// 1. ENVIRONMENT FALLBACK
const fetch = global.fetch || require("node-fetch");

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
  PermissionFlagsBits, // Added for permission handling
} = require("discord.js");

module.exports = {
  name: "totw-cashout",
  description: "TOTW Treasury: Send gold from the totw bank",
  // Hides the command from users without 'Manage Roles' permission by default
  // This is the first layer of visibility protection
  default_member_permissions: PermissionFlagsBits.ManageRoles,

  async execute(interaction) {
    // --- DEPARTMENT CONFIGURATION ---
    const DEPT_ROLE_ID = "1434948030842405045";
    const LOG_CHANNEL_ID = "1472518058445635694";
    const VALID_CHANNEL_IDS = ["1435117294454833212", "1434947454289313902"];

    const DEPT_GAME_ID = process.env.TOTW_ACCOUNT_NAME;
    const DEPT_GAME_PASS = process.env.TOTW_ACCOUNT_PASS;
    const MAX_TRANSFER = 1500;
    // --------------------------------

    // 1. CHANNEL RESTRICTION CHECK
    if (!VALID_CHANNEL_IDS.includes(interaction.channelId)) {
      return interaction.reply({
        content: `❌ **Wrong Channel:** This command can only be used in specified treasury channels.`,
        flags: [MessageFlags.Ephemeral],
      });
    }

    // 2. ROLE PERMISSION CHECK (Hard check in the code)
    if (!interaction.member.roles.cache.has(DEPT_ROLE_ID)) {
      return interaction.reply({
        content:
          "❌ **Access Denied:** You do not have the required TOTW Department role.",
        flags: [MessageFlags.Ephemeral],
      });
    }

    // 3. SECURE ENV CHECK
    if (!DEPT_GAME_ID || !DEPT_GAME_PASS) {
      return interaction.reply({
        content:
          "🚨 **System Error:** TOTW Account credentials are not configured.",
        ephemeral: true,
      });
    }

    const targetID = interaction.options.getString("account_id")?.trim();
    const amount = interaction.options.getInteger("amount");

    // 4. INPUT VALIDATION
    if (!targetID || amount <= 0) {
      return interaction.reply({
        content: "❌ Invalid Input.",
        ephemeral: true,
      });
    }
    if (amount > MAX_TRANSFER) {
      return interaction.reply({
        content: `❌ Amount exceeds totw bank limit (${MAX_TRANSFER}).`,
        ephemeral: true,
      });
    }

    let isProcessing = false;

    // 5. UI INITIALIZATION
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
        .setCustomId("confirm_dept")
        .setLabel("Confirm & Send")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("cancel_dept")
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary),
    );

    const response = await interaction.reply({
      embeds: [confirmEmbed],
      components: [row],
      fetchReply: true,
    });

    const collector = response.createMessageComponentCollector({
      filter: (i) => i.user.id === interaction.user.id,
      componentType: ComponentType.Button,
      time: 60000,
    });

    collector.on("collect", async (i) => {
      if (isProcessing) return;

      if (i.customId === "cancel_dept") {
        collector.stop("cancelled");
        return i.update({
          content: "❌ **Transfer Cancelled by User.**",
          embeds: [],
          components: [],
        });
      }

      isProcessing = true;
      await i.deferUpdate();

      await interaction.editReply({
        content: "📡 **Processing TOTW Payout...**",
        components: [],
        embeds: [],
      });

      const fetchController = new AbortController();
      const timeoutId = setTimeout(() => fetchController.abort(), 15000);

      try {
        const apiResponse = await fetch(
          "https://territorial.io/api/gold/send",
          {
            method: "POST",
            signal: fetchController.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              account_name: DEPT_GAME_ID,
              password: DEPT_GAME_PASS,
              target_account_name: targetID,
              amount: amount,
            }),
          },
        );

        const data = await apiResponse.json();
        const isSuccess = data.status === "ok" || data.status === "success";

        if (isSuccess) {
          const logChannel =
            interaction.guild.channels.cache.get(LOG_CHANNEL_ID);
          if (logChannel) {
            const logEmbed = new EmbedBuilder()
              .setTitle("🏦 TOTW Treasury: Transaction Log")
              .setColor(0x3498db)
              .addFields(
                {
                  name: "👤 Executed By",
                  value: `${interaction.user.tag} (${interaction.user.id})`,
                },
                {
                  name: "🎯 Recipient Game ID",
                  value: `\`${targetID}\``,
                  inline: true,
                },
                {
                  name: "💰 Amount Sent",
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
        }

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
        const errorMsg =
          err.name === "AbortError" ? "Network Timeout (15s)" : err.message;
        await interaction.editReply({
          content: `🚨 **Critical Error:** ${errorMsg}`,
          embeds: [],
        });
        collector.stop("error");
      } finally {
        clearTimeout(timeoutId);
      }
    });

    collector.on("end", async (_, reason) => {
      if (reason === "time") {
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
