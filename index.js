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

      // SMART ERROR HANDLING: Prevents "Interaction already acknowledged"
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
          .setLabel("Amount to Withdraw")
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

      const ROLE_ID = "1464514701596688524";
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
      const amount = parseInt(
        interaction.fields.getTextInputValue("withdraw_amount"),
      );
      const customAccount =
        interaction.fields.getTextInputValue("withdraw_account");

      const userData = await User.findOne({ userId: userId });

      if (isNaN(amount) || amount <= 0)
        return interaction.reply({
          content: "❌ Invalid number.",
          ephemeral: true,
        });

      if (!userData || !userData.verified)
        return interaction.reply({
          content: "❌ You must be verified to withdraw.",
          ephemeral: true,
        });

      if (userData.gold < amount)
        return interaction.reply({
          content: `❌ Insufficient balance!`,
          ephemeral: true,
        });

      const target = customAccount || userData?.ttio;
      const fee = Math.floor(amount * 0.03);
      const receiveAmount = amount - fee;

      userData.gold -= amount;
      await userData.save();

      const receiptEmbed = new EmbedBuilder()
        .setTitle("📤 Withdrawal Requested")
        .setColor(0x3498db)
        .addFields(
          { name: "💰 Total Deducted", value: `${amount} Gold`, inline: true },
          { name: "📉 Service Fee (3%)", value: `-${fee} Gold`, inline: true },
          {
            name: "🎁 You Receive",
            value: `**${receiveAmount} Gold**`,
            inline: true,
          },
          { name: "🎮 Destination", value: `\`${target}\``, inline: false },
        )
        .setTimestamp();

      await interaction.user.send({ embeds: [receiptEmbed] }).catch(() => null);

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
                { name: "Payout", value: `**${receiveAmount}**`, inline: true },
              ),
          ],
        });
      }

      await interaction.reply({
        content: `✅ **Request Sent!** You will receive **${receiveAmount}** gold shortly.`,
        ephemeral: true,
      });
    }
  }
});

client.login(process.env.TOKEN);
