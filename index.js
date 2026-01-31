// 1. LOAD ENV FIRST
require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Events,
  Collection,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
} = require("discord.js");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const { startTracking } = require("./checkTransactions");
const User = require("./models/User");

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// --- COOLDOWN SYSTEM ---
const cooldowns = new Map();

// 2. CONNECT TO MONGODB ATLAS
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ Connected to MongoDB Atlas"))
  .catch((err) => console.error("❌ MongoDB Connection Error:", err));

// --- Load Commands Dynamically ---
client.commands = new Collection();
const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs
  .readdirSync(commandsPath)
  .filter((file) => file.endsWith(".js"));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.name, command);
}

client.once(Events.ClientReady, () => {
  console.log(`✅ ${client.user.tag} is online!`);
  startTracking(client);
});

client.on(Events.InteractionCreate, async (interaction) => {
  // 1. HANDLE SLASH COMMANDS
  if (interaction.isChatInputCommand()) {
    const userId = interaction.user.id;
    const now = Date.now();
    const cooldownAmount = 5000;

    if (cooldowns.has(userId)) {
      const expirationTime = cooldowns.get(userId) + cooldownAmount;
      if (now < expirationTime) {
        const timeLeft = (expirationTime - now) / 1000;
        return interaction.reply({
          content: `⏱️ **Slow down!** You can use another command in **${timeLeft.toFixed(1)}s**.`,
          ephemeral: true,
        });
      }
    }

    cooldowns.set(userId, now);
    setTimeout(() => cooldowns.delete(userId), cooldownAmount);

    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    try {
      await command.execute(interaction);
    } catch (error) {
      console.error("❌ Command Execution Error:", error);
      const errorPayload = {
        content: "❌ There was an error executing this command!",
        ephemeral: true,
      };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorPayload).catch(() => null);
      } else {
        await interaction.reply(errorPayload).catch(() => null);
      }
    }
  }

  // 2. HANDLE BUTTON CLICKS
  if (interaction.isButton()) {
    try {
      if (interaction.customId === "open_register_modal") {
        const modal = new ModalBuilder()
          .setCustomId("register_modal")
          .setTitle("Account Registration");
        const usernameInput = new TextInputBuilder()
          .setCustomId("ttio_username")
          .setLabel("Territorial.io Account ID")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Enter your exact game Account ID (Example : AWwh_)")
          .setRequired(true);
        modal.addComponents(
          new ActionRowBuilder().addComponents(usernameInput),
        );
        await interaction.showModal(modal);
      }

      if (interaction.customId === "open_withdraw_modal") {
        const modal = new ModalBuilder()
          .setCustomId("withdraw_modal")
          .setTitle("Withdraw Gold");
        const amountInput = new TextInputBuilder()
          .setCustomId("withdraw_amount")
          .setLabel("Amount to Withdraw (Min: 50)")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("e.g. 1000")
          .setRequired(true);
        const accountInput = new TextInputBuilder()
          .setCustomId("withdraw_account")
          .setLabel("Destination Account ID (Optional)")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Leave blank to use your registered Account ID")
          .setRequired(false);
        modal.addComponents(
          new ActionRowBuilder().addComponents(amountInput),
          new ActionRowBuilder().addComponents(accountInput),
        );
        await interaction.showModal(modal);
      }
    } catch (err) {
      console.error("Button Error:", err);
    }
  }

  // 3. HANDLE MODAL SUBMISSIONS
  if (interaction.isModalSubmit()) {
    const userId = interaction.user.id;

    if (interaction.customId === "register_modal") {
      const ttioName = interaction.fields.getTextInputValue("ttio_username");
      await User.findOneAndUpdate(
        { userId: userId },
        { ttio: ttioName, $setOnInsert: { gold: 0, verified: false } },
        { upsert: true, new: true },
      );

      const ROLE_ID = "1465208410852294708";
      const role = interaction.guild.roles.cache.get(ROLE_ID);
      if (role) {
        try {
          await interaction.member.roles.add(role);
        } catch (e) {
          console.error(e);
        }
      }

      await interaction.reply({
        content: `✅ **Success!** Linked to **${ttioName}**.\nNow send gold to **AWwh_** in-game to verify.`,
        ephemeral: true,
      });
    }

    if (interaction.customId === "withdraw_modal") {
      const amountInput =
        interaction.fields.getTextInputValue("withdraw_amount");
      const amount = parseInt(amountInput);
      const customAccount =
        interaction.fields.getTextInputValue("withdraw_account");

      if (isNaN(amount) || amount < 50) {
        return interaction.reply({
          content: "❌ **Withdrawal Failed:** Minimum withdrawal is `50` gold.",
          ephemeral: true,
        });
      }

      const userData = await User.findOne({ userId: userId });
      if (!userData || !userData.verified) {
        return interaction.reply({
          content: "❌ You must be verified to withdraw.",
          ephemeral: true,
        });
      }

      if (userData.gold < amount) {
        return interaction.reply({
          content: `❌ **Insufficient Balance!** You only have \`${userData.gold.toLocaleString()}\` gold.`,
          ephemeral: true,
        });
      }

      const target = customAccount || userData.ttio || "Unknown";
      const fee = Math.floor(amount * 0.03);
      const receiveAmount = amount - fee;

      userData.gold -= amount;
      await userData.save();

      // --- UNIFIED WITHDRAWAL UI (Matches Deposit Style) ---
      const receiptEmbed = new EmbedBuilder()
        .setTitle("📤 Withdrawal Request")
        .setColor(0xe74c3c)
        .setThumbnail(interaction.user.displayAvatarURL())
        .addFields(
          { name: "👤 User", value: `<@${userId}>`, inline: true },
          { name: "🎮 Destination", value: `\`${target}\``, inline: true },
          {
            name: "💰 Total Deducted",
            value: `\`${amount.toLocaleString()}\` Gold`,
            inline: false,
          },
          {
            name: "📉 Service Fee (3%)",
            value: `\`${fee.toLocaleString()}\` Gold`,
            inline: true,
          },
          {
            name: "🎁 Net Payout",
            value: `**${receiveAmount.toLocaleString()} Gold**`,
            inline: true,
          },
        )
        .setFooter({ text: `User ID: ${userId}` })
        .setTimestamp();

      // --- LOG TO CHANNEL ---
      const logChannelId = process.env.LOG_CHANNEL_ID;
      try {
        const logChannel = await client.channels.fetch(logChannelId);
        if (logChannel) {
          await logChannel.send({
            content: `🚨 **NEW WITHDRAWAL** from <@${userId}>`,
            embeds: [receiptEmbed],
          });
        }
      } catch (err) {
        console.error("❌ Withdrawal Log Channel Error:", err);
      }

      // --- SEND DM ---
      await interaction.user
        .send({
          content: "✅ Your withdrawal request has been submitted.",
          embeds: [receiptEmbed],
        })
        .catch(() => null);

      await interaction.reply({
        content: `✅ **Request Sent!** You will receive **${receiveAmount.toLocaleString()}** gold shortly.`,
        ephemeral: true,
      });
    }
  }
});

client.login(process.env.TOKEN);
