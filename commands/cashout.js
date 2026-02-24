// 1. ENVIRONMENT FALLBACK (Node 18+ vs older runtimes)
const fetch = global.fetch || require("node-fetch");

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const AuditLog = require("../models/AuditLog");
const { logToAudit } = require("../utils/logger");

module.exports = {
  name: "cashout",
  description: "Treasury: Sends gold from the Master Account to a game ID",
  async execute(interaction) {
    const MAX_CASHOUT = 5000;

    // 🔒 ROLE-BASED ACCESS CONTROL (ONLY THIS ROLE CAN USE COMMAND)
    const ALLOWED_ROLE_ID = "1475908523396300871"; // <-- PUT YOUR ROLE ID HERE

    if (!interaction.member.roles.cache.has(ALLOWED_ROLE_ID)) {
      return interaction.reply({
        content:
          "❌ You are not authorized to use the treasury cashout command.",
        ephemeral: true,
      });
    }

    // 2. INPUT SANITIZATION
    const targetTTIO = interaction.options.getString("account_id")?.trim();
    const amount = interaction.options.getInteger("amount");

    if (!targetTTIO) {
      return interaction.reply({
        content: "❌ Invalid account ID.",
        ephemeral: true,
      });
    }

    if (!amount || amount <= 0) {
      return interaction.reply({
        content: "❌ Amount must be a positive number.",
        ephemeral: true,
      });
    }

    if (amount > MAX_CASHOUT) {
      return interaction.reply({
        content: `❌ **Security Alert:** Transfer exceeds the limit of ${MAX_CASHOUT.toLocaleString()} gold.`,
        ephemeral: true,
      });
    }

    let isProcessing = false;

    // 3. UI INITIALIZATION
    const confirmEmbed = new EmbedBuilder()
      .setTitle("🏦 Treasury: Cashout Request")
      .setColor(0xffaa00)
      .setDescription(`Authorizing transfer to **${targetTTIO}**.`)
      .addFields({
        name: "💰 Amount",
        value: `\`${amount.toLocaleString()}\` Gold`,
        inline: true,
      })
      .setFooter({ text: `Requested by ${interaction.user.tag}` });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("confirm_api")
        .setLabel("Confirm & Send")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("cancel_api")
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

      if (i.customId === "cancel_api") {
        collector.stop("cancelled");
        return i.update({
          content: "❌ **Transfer Aborted.**",
          embeds: [],
          components: [],
        });
      }

      isProcessing = true;

      await i.update({
        content: "📡 **Executing API Transaction...**",
        components: [],
        embeds: [],
      });

      // 4. NETWORK TIMEOUT & ABORT LOGIC
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
              account_name: process.env.IO_ACCOUNT_NAME,
              password: process.env.IO_PASSWORD,
              target_account_name: targetTTIO,
              amount: amount,
            }),
          },
        );

        if (!apiResponse.ok) {
          throw new Error(`HTTP Error: ${apiResponse.status}`);
        }

        const rawText = await apiResponse.text();

        let data;
        try {
          data = JSON.parse(rawText);
        } catch (e) {
          throw new Error("Invalid JSON response from game server.");
        }

        const isSuccess = data.status === "ok" || data.status === "success";

        // DATABASE & AUDIT LOGGING ON SUCCESS
        if (isSuccess) {
          await AuditLog.create({
            modId: interaction.user.id,
            modTag: interaction.user.tag,
            targetId: targetTTIO,
            action: "CASHOUT_API",
            amount,
            timestamp: new Date(),
          }).catch(console.error);

          await logToAudit(interaction.client, {
            userId: "N/A",
            adminId: interaction.user.id,
            amount,
            oldBalance: "Master Vault",
            newBalance: "Master Vault",
            reason: `Manual Cashout to ${targetTTIO}`,
          }).catch(() => null);
        }

        // 5. EMBED FIELD OVERFLOW PROTECTION
        const apiDump = JSON.stringify(data, null, 2).slice(0, 950);

        const proofEmbed = new EmbedBuilder()
          .setTitle(isSuccess ? "✅ CASHOUT DISPATCHED" : "⚠️ API REJECTED")
          .setColor(isSuccess ? 0x2ecc71 : 0xe74c3c)
          .addFields(
            {
              name: "Recipient",
              value: `\`${targetTTIO}\``,
              inline: true,
            },
            {
              name: "Sent",
              value: `\`${amount.toLocaleString()}\` Gold`,
              inline: true,
            },
            {
              name: "API Reference",
              value: `\`\`\`json\n${apiDump}\n\`\`\``,
            },
          )
          .setTimestamp();

        await interaction.editReply({
          content: isSuccess
            ? "✨ **Success!** Gold dispatched."
            : "❌ Transaction rejected by game server.",
          embeds: [proofEmbed],
        });

        collector.stop("finished");
      } catch (err) {
        const errorMsg =
          err.name === "AbortError" ? "Network Timeout (15s)" : err.message;

        console.error("Critical API Failure:", errorMsg);

        await interaction.editReply({
          content: `🚨 **API Failure:** ${errorMsg}`,
          embeds: [],
          components: [],
        });

        collector.stop("error");
      } finally {
        // 🛡️ MEMORY SAFETY
        clearTimeout(timeoutId);
      }
    });

    collector.on("end", async (_, reason) => {
      if (reason === "time") {
        await interaction
          .editReply({
            content: "⌛ **Timed Out.**",
            components: [],
            embeds: [],
          })
          .catch(() => null);
      }
    });
  },
};
