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
  ButtonBuilder,
  ButtonStyle,
  TextChannel,
  NewsChannel,
  ThreadChannel,
} = require("discord.js");

// --- HELPER IMPORTS ---
const {
  updateTriggerCache,
  getTriggerCache,
} = require("./utils/triggerHelper");

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const { startTracking } = require("./checkTransactions");
const User = require("./models/User");
const Lottery = require("./models/Lottery");
const LotteryTicket = require("./models/LotteryTicket");
const { buildLotteryEmbed } = require("./utils/lotteryEmbed");
const { logToAudit } = require("./utils/logger");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

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

  // Support both old (name) and new (data.name) command formats
  const commandName = command.name || command.data?.name;

  if (!commandName) {
    console.warn(`⚠️ Command in ${file} is missing a name.`);
    continue;
  }

  client.commands.set(commandName, command);
}

// --- LOTTERY RECOVERY SYSTEM ---
async function recoverLotteries() {
  try {
    const activeLotteries = await Lottery.find({ isClosed: false });
    if (!activeLotteries.length) return;

    console.log(`🎰 Recovering ${activeLotteries.length} active lottery(s)...`);

    for (const lottery of activeLotteries) {
      try {
        const guild = await client.guilds
          .fetch(lottery.guildId)
          .catch(() => null);
        if (!guild) continue;

        const channel = await guild.channels
          .fetch(lottery.channelId)
          .catch(() => null);
        if (
          !channel ||
          !(
            channel instanceof TextChannel ||
            channel instanceof NewsChannel ||
            channel instanceof ThreadChannel
          )
        )
          continue;

        const embed = await buildLotteryEmbed(lottery.messageId, guild);
        if (!embed) continue;

        const buttonRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("buy_ticket")
            .setLabel("🎟️ Buy Ticket (250 Gold)")
            .setStyle(ButtonStyle.Success),
        );

        let message;
        try {
          message = await channel.messages.fetch(lottery.messageId);
          await message.edit({ embeds: [embed], components: [buttonRow] });
        } catch {
          message = await channel.send({
            embeds: [embed],
            components: [buttonRow],
          });
          await Lottery.updateOne(
            { messageId: lottery.messageId },
            { messageId: message.id },
          );
          console.log(`♻️ Lottery message recovered: ${message.id}`);
        }
      } catch (err) {
        console.error("❌ Lottery Recovery Error:", err);
      }
    }
  } catch (err) {
    console.error("❌ Failed to recover lotteries:", err);
  }
}

// --- CLIENT READY ---
client.once(Events.ClientReady, async () => {
  console.log(`✅ ${client.user.tag} is online!`);

  // Initial load of triggers from the helper
  await updateTriggerCache();

  startTracking(client);
  await recoverLotteries();
});

// --- INTERACTIONS ---
client.on(Events.InteractionCreate, async (interaction) => {
  // ================= SLASH COMMANDS =================
  if (interaction.isChatInputCommand()) {
    const userId = interaction.user.id;
    const now = Date.now();
    const cooldownAmount = 5000;

    if (cooldowns.has(userId)) {
      const expirationTime = cooldowns.get(userId) + cooldownAmount;
      if (now < expirationTime) {
        const timeLeft = (expirationTime - now) / 1000;
        return interaction.reply({
          content: `⏱️ Slow down! You can use another command in ${timeLeft.toFixed(1)}s.`,
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
      const payload = {
        content: "❌ There was an error executing this command!",
        ephemeral: true,
      };
      if (interaction.replied || interaction.deferred)
        await interaction.followUp(payload).catch(() => null);
      else await interaction.reply(payload).catch(() => null);
    }
  }

  // ================= BUTTONS =================
  if (interaction.isButton()) {
    try {
      if (interaction.customId === "buy_ticket") {
        const TICKET_PRICE = 250;
        const LOTTERY_ROLE_ID = "1380456068685107301";

        const lottery = await Lottery.findOne({
          guildId: interaction.guild.id,
          isClosed: false,
        });
        if (!lottery)
          return interaction.reply({
            content: "🛑 No active lottery found.",
            ephemeral: true,
          });

        if (Date.now() >= lottery.endTime) {
          await Lottery.updateOne(
            { messageId: lottery.messageId },
            { isClosed: true },
          );
          return interaction.reply({
            content: "🛑 Lottery has already ended.",
            ephemeral: true,
          });
        }

        await interaction.deferReply({ ephemeral: true });

        const updatedUser = await User.findOneAndUpdate(
          { userId: interaction.user.id, gold: { $gte: TICKET_PRICE } },
          { $inc: { gold: -TICKET_PRICE } },
          { new: true },
        );

        if (!updatedUser)
          return interaction.editReply({ content: "❌ Insufficient gold." });

        await logToAudit(client, {
          userId: interaction.user.id,
          bet: TICKET_PRICE,
          amount: -TICKET_PRICE,
          oldBalance: updatedUser.gold + TICKET_PRICE,
          newBalance: updatedUser.gold,
          reason: `Lottery Ticket Purchase [${lottery.messageId}]`,
        }).catch(() => null);

        const displayName =
          interaction.user.globalName || interaction.user.username;
        await Lottery.updateOne(
          { messageId: lottery.messageId },
          { $inc: { totalTickets: 1, poolBalance: TICKET_PRICE } },
        );
        await LotteryTicket.findOneAndUpdate(
          { messageId: lottery.messageId, userId: interaction.user.id },
          { $inc: { tickets: 1 }, $setOnInsert: { username: displayName } },
          { upsert: true },
        );

        try {
          const member = await interaction.guild.members.fetch(
            interaction.user.id,
          );
          if (!member.roles.cache.has(LOTTERY_ROLE_ID))
            await member.roles.add(LOTTERY_ROLE_ID);
        } catch (e) {}

        await interaction.editReply({
          content: "🎫 Ticket purchased successfully!",
        });

        try {
          const channel = await interaction.guild.channels.fetch(
            lottery.channelId,
          );
          const msg = await channel.messages.fetch(lottery.messageId);
          const embed = await buildLotteryEmbed(
            lottery.messageId,
            interaction.guild,
          );
          if (embed) await msg.edit({ embeds: [embed] });
        } catch (e) {}
      }

      if (interaction.customId === "open_withdraw_modal") {
        const modal = new ModalBuilder()
          .setCustomId("withdraw_modal")
          .setTitle("Withdraw Gold");
        const amountInput = new TextInputBuilder()
          .setCustomId("withdraw_amount")
          .setLabel("Amount (Min: 50)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        const accountInput = new TextInputBuilder()
          .setCustomId("withdraw_account")
          .setLabel("Destination Account ID")
          .setStyle(TextInputStyle.Short)
          .setRequired(false);
        modal.addComponents(
          new ActionRowBuilder().addComponents(amountInput),
          new ActionRowBuilder().addComponents(accountInput),
        );
        return interaction.showModal(modal);
      }

      if (interaction.customId === "open_register_modal") {
        const modal = new ModalBuilder()
          .setCustomId("register_modal")
          .setTitle("Account Registration");
        const usernameInput = new TextInputBuilder()
          .setCustomId("ttio_username")
          .setLabel("Territorial.io Account ID")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        modal.addComponents(
          new ActionRowBuilder().addComponents(usernameInput),
        );
        return interaction.showModal(modal);
      }
    } catch (err) {
      console.error("Button Error:", err);
    }
  }

  // ================= MODAL SUBMITS =================
  if (interaction.isModalSubmit()) {
    try {
      const userId = interaction.user.id;
      if (interaction.customId === "register_modal") {
        const ttioName = interaction.fields.getTextInputValue("ttio_username");
        await User.findOneAndUpdate(
          { userId },
          { ttio: ttioName, $setOnInsert: { gold: 0, verified: false } },
          { upsert: true },
        );
        const ROLE_ID = "1465208410852294708";
        try {
          const role = interaction.guild.roles.cache.get(ROLE_ID);
          if (role) await interaction.member.roles.add(role);
        } catch (e) {}
        return interaction.reply({
          content: `✅ Linked to **${ttioName}**.\nVerify by sending gold to **AWwh_**.`,
          ephemeral: true,
        });
      }

      if (interaction.customId === "withdraw_modal") {
        const amount = parseInt(
          interaction.fields.getTextInputValue("withdraw_amount"),
        );
        const accountInput =
          interaction.fields.getTextInputValue("withdraw_account");

        if (isNaN(amount) || amount < 50)
          return interaction.reply({
            content: "❌ Min withdrawal is 50 Gold.",
            ephemeral: true,
          });
        const user = await User.findOne({ userId });
        if (!user || user.gold < amount)
          return interaction.reply({
            content: "❌ Insufficient gold.",
            ephemeral: true,
          });

        const destination = accountInput?.trim() || user.ttio;
        if (!destination)
          return interaction.reply({
            content: "❌ No destination set.",
            ephemeral: true,
          });

        const fee = Math.floor(amount * 0.03);
        const net = amount - fee;

        await User.updateOne({ userId }, { $inc: { gold: -amount } });
        await logToAudit(client, {
          userId,
          bet: amount,
          amount: -amount,
          oldBalance: user.gold,
          newBalance: user.gold - amount,
          reason: `Withdrawal → ${destination}`,
        });

        const logChan = await interaction.guild.channels
          .fetch(process.env.LOG_CHANNEL_ID)
          .catch(() => null);
        if (logChan) {
          const embed = new EmbedBuilder()
            .setTitle("📤 WITHDRAWAL REQUEST")
            .setColor(0xe74c3c)
            .addFields(
              { name: "👤 User", value: `<@${userId}>`, inline: true },
              { name: "🎯 Target", value: `\`${destination}\``, inline: true },
              { name: "🎁 Net", value: `${net} Gold`, inline: true },
            );
          await logChan.send({ embeds: [embed] });
        }
        return interaction.reply({
          content: "📤 Request submitted!",
          ephemeral: true,
        });
      }
    } catch (err) {
      console.error("Modal Error:", err);
    }
  }
});

// --- AUTO-REACTION LISTENER ---
// --- AUTO-REACTION LISTENER ---
client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;

  const content = message.content.toLowerCase();
  const triggerCache = getTriggerCache();

  for (const item of triggerCache) {
    if (content.includes(item.keyword.toLowerCase())) {
      try {
        // Check if it's a numeric ID (Custom Emoji)
        const isCustomEmoji = /^\d+$/.test(item.emojiId);

        if (isCustomEmoji) {
          // Verify the bot can actually see this emoji
          const emoji = client.emojis.cache.get(item.emojiId);
          if (emoji) {
            await message.react(item.emojiId);
          } else {
            console.warn(
              `⚠️ Cannot react: Emoji ${item.emojiId} not found in bot's cache.`,
            );
          }
        } else {
          // It's a standard Unicode emoji (e.g., "🔥")
          await message.react(item.emojiId);
        }
      } catch (err) {
        // Silently fail if the emoji is invalid or bot lacks perms
        if (err.code !== 10014) {
          // Ignore "Unknown Emoji" error code
          console.error(`❌ React failed for "${item.keyword}":`, err.message);
        }
      }
    }
  }
});

// --- LOGIN ---
client.login(process.env.TOKEN);
