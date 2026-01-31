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

const MAIN_GUILD_ID = process.env.GUILD_ID;
const WITHDRAW_LOG_CHANNEL_ID = "YOUR_WITHDRAW_CHANNEL_ID";

// ---------------- CLIENT ----------------
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// ---------------- COOLDOWN SYSTEM ----------------
const cooldowns = new Map();

// ---------------- MONGODB ----------------
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ Connected to MongoDB Atlas"))
  .catch((err) => console.error("❌ MongoDB Connection Error:", err));

// ---------------- LOAD COMMANDS ----------------
client.commands = new Collection();
const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs
  .readdirSync(commandsPath)
  .filter((file) => file.endsWith(".js"));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.name, command);
}

// ---------------- READY ----------------
client.once(Events.ClientReady, async () => {
  console.log(`✅ ${client.user.tag} is online!`);

  for (const guild of client.guilds.cache.values()) {
    if (guild.id !== MAIN_GUILD_ID) {
      console.log(`🚫 Leaving unauthorized guild: ${guild.name} (${guild.id})`);
      await guild.leave();
    }
  }

  startTracking(client);
});

// ---------------- AUTO LEAVE ----------------
client.on(Events.GuildCreate, async (guild) => {
  if (guild.id !== MAIN_GUILD_ID) {
    await guild.leave();
  }
});

// ---------------- INTERACTIONS ----------------
client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.guildId !== MAIN_GUILD_ID) {
    return interaction.reply({
      content: "🚫 This bot is not authorized for this server.",
      ephemeral: true,
    });
  }

  // ---------- SLASH COMMANDS ----------
  if (interaction.isChatInputCommand()) {
    const userId = interaction.user.id;
    const now = Date.now();
    const cooldownAmount = 5000;

    if (cooldowns.has(userId)) {
      const expirationTime = cooldowns.get(userId) + cooldownAmount;
      if (now < expirationTime) {
        return interaction.reply({
          content: `⏱️ Try again in **${((expirationTime - now) / 1000).toFixed(
            1,
          )}s**.`,
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
    } catch (err) {
      console.error(err);
      if (!interaction.replied) {
        await interaction.reply({
          content: "❌ Error executing command.",
          ephemeral: true,
        });
      }
    }
  }

  // ---------- BUTTONS ----------
  if (interaction.isButton()) {
    try {
      if (interaction.customId === "open_register_modal") {
        const modal = new ModalBuilder()
          .setCustomId("register_modal")
          .setTitle("Account Registration");

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("ttio_username")
              .setLabel("Territorial.io Account ID")
              .setStyle(TextInputStyle.Short)
              .setRequired(true),
          ),
        );

        return interaction.showModal(modal);
      }

      if (interaction.customId === "open_withdraw_modal") {
        const modal = new ModalBuilder()
          .setCustomId("withdraw_modal")
          .setTitle("Withdraw Gold");

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("withdraw_amount")
              .setLabel("Amount to Withdraw (Min: 50)")
              .setStyle(TextInputStyle.Short)
              .setRequired(true),
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId("withdraw_account")
              .setLabel("Destination Account ID (Optional)")
              .setStyle(TextInputStyle.Short)
              .setRequired(false),
          ),
        );

        return interaction.showModal(modal);
      }
    } catch (err) {
      console.error("❌ Button Error:", err);
    }
  }

  // ---------- MODALS ----------
  if (interaction.isModalSubmit()) {
    const userId = interaction.user.id;

    // REGISTER
    if (interaction.customId === "register_modal") {
      const ttio = interaction.fields.getTextInputValue("ttio_username");

      await User.findOneAndUpdate(
        { userId },
        { ttio, $setOnInsert: { gold: 0, verified: false } },
        { upsert: true },
      );

      const role = interaction.guild.roles.cache.get("1465208410852294708");
      if (role) await interaction.member.roles.add(role).catch(() => null);

      return interaction.reply({
        content: `✅ Linked to **${ttio}**.\nSend gold to **AWwh_** to verify.`,
        ephemeral: true,
      });
    }

    // WITHDRAW
    if (interaction.customId === "withdraw_modal") {
      const amount = parseInt(
        interaction.fields.getTextInputValue("withdraw_amount"),
      );

      if (isNaN(amount) || amount < 50) {
        return interaction.reply({
          content: "❌ Minimum withdrawal is **50 gold**.",
          ephemeral: true,
        });
      }

      const userData = await User.findOne({ userId });
      if (!userData || !userData.verified) {
        return interaction.reply({
          content: "❌ You must be verified to withdraw.",
          ephemeral: true,
        });
      }

      if (userData.gold < amount) {
        return interaction.reply({
          content: "❌ Insufficient balance.",
          ephemeral: true,
        });
      }

      const fee = Math.floor(amount * 0.03);
      const receiveAmount = amount - fee;

      userData.gold -= amount;
      await userData.save();

      // ----- DM USER -----
      try {
        await interaction.user.send(
          `💸 **Withdrawal Requested**\n\n` +
            `Requested: **${amount}** gold\n` +
            `Fee: **${fee}** gold\n` +
            `You will receive: **${receiveAmount}** gold`,
        );
      } catch {}

      // ----- LOG CHANNEL -----
      const logChannel = interaction.guild.channels.cache.get(
        WITHDRAW_LOG_CHANNEL_ID,
      );

      if (logChannel) {
        const embed = new EmbedBuilder()
          .setTitle("💸 Withdrawal Request")
          .setColor(0xf1c40f)
          .addFields(
            { name: "User", value: `<@${userId}>`, inline: false },
            { name: "Amount", value: `${amount}`, inline: true },
            { name: "Fee", value: `${fee}`, inline: true },
            { name: "Net", value: `${receiveAmount}`, inline: true },
          )
          .setTimestamp();

        await logChannel.send({ embeds: [embed] });
      }

      return interaction.reply({
        content: `✅ Withdrawal request sent.\nYou will receive **${receiveAmount}** gold.`,
        ephemeral: true,
      });
    }
  }
});

// ---------------- LOGIN ----------------
client.login(process.env.TOKEN);
