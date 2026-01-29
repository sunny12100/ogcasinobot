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
    // --- COOLDOWN LOGIC START ---
    const userId = interaction.user.id;
    const now = Date.now();
    const cooldownAmount = 3000; // 3 seconds in milliseconds

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

    // Set timestamp and auto-delete after cooldown ends
    cooldowns.set(userId, now);
    setTimeout(() => cooldowns.delete(userId), cooldownAmount);
    // --- COOLDOWN LOGIC END ---

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

    // --- REGISTRATION SUBMISSION ---
    if (interaction.customId === "register_modal") {
      const ttioName = interaction.fields.getTextInputValue("ttio_username");

      await User.findOneAndUpdate(
        { userId: userId },
        {
          ttio: ttioName,
          $setOnInsert: { gold: 0, verified: false },
        },
        { upsert: true, new: true },
      );

      const ROLE_ID = "1465208410852294708";
      const role = interaction.guild.roles.cache.get(ROLE_ID);

      if (role) {
        try {
          await interaction.member.roles.add(role);
        } catch (error) {
          console.error("❌ Role error:", error);
        }
      }

      await interaction.reply({
        content: `✅ **Success!** Linked to **${ttioName}**.\nNow send gold to **AWwh_** in-game to verify.`,
        ephemeral: true,
      });
    }

    // --- WITHDRAWAL SUBMISSION ---
    if (interaction.customId === "withdraw_modal") {
      const amountInput =
        interaction.fields.getTextInputValue("withdraw_amount");
      const amount = parseInt(amountInput);
      const customAccount =
        interaction.fields.getTextInputValue("withdraw_account");

      // 🛑 MINIMUM WITHDRAWAL CHECK
      if (isNaN(amount) || amount < 50) {
        return interaction.reply({
          content:
            "❌ **Withdrawal Failed:** The minimum amount you can withdraw is `50` gold.",
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

      const target = customAccount || userData?.ttio || "Unknown";
      const fee = Math.floor(amount * 0.03); // 3% fee
      const receiveAmount = amount - fee;

      // Update Database
      userData.gold -= amount;
      await userData.save();

      // Create Receipt for User
      const receiptEmbed = new EmbedBuilder()
        .setTitle("📤 Withdrawal Requested")
        .setColor(0x3498db)
        .addFields(
          {
            name: "💰 Total Deducted",
            value: `${amount.toLocaleString()} Gold`,
            inline: true,
          },
          {
            name: "📉 Service Fee (3%)",
            value: `-${fee.toLocaleString()} Gold`,
            inline: true,
          },
          {
            name: "🎁 You Receive",
            value: `**${receiveAmount.toLocaleString()} Gold**`,
            inline: true,
          },
          { name: "🎮 Destination", value: `\`${target}\``, inline: false },
        )
        .setTimestamp();

      await interaction.user.send({ embeds: [receiptEmbed] }).catch(() => null);

      // Log for Admins
      const logChannelId = process.env.LOG_CHANNEL_ID;
      const logChannel =
        client.channels.cache.get(logChannelId) ||
        (await client.channels.fetch(logChannelId).catch(() => null));

      if (logChannel) {
        logChannel.send({
          content: `🚨 **NEW WITHDRAWAL**`,
          embeds: [
            new EmbedBuilder()
              .setColor(0xffa500)
              .addFields(
                { name: "User", value: `<@${userId}>`, inline: true },
                { name: "Target", value: `\`${target}\``, inline: true },
                {
                  name: "Payout",
                  value: `**${receiveAmount.toLocaleString()}**`,
                  inline: true,
                },
              )
              .setTimestamp(),
          ],
        });
      }

      await interaction.reply({
        content: `✅ **Request Sent!** You will receive **${receiveAmount.toLocaleString()}** gold shortly.`,
        ephemeral: true,
      });
    }
  }
});

client.login(process.env.TOKEN);
