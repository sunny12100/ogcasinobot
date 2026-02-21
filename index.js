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
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const { startTracking } = require("./checkTransactions");
const User = require("./models/User");
const Lottery = require("./models/Lottery");
const LotteryTicket = require("./models/LotteryTicket");
const { buildLotteryEmbed } = require("./utils/lotteryEmbed");
const { logToAudit } = require("./utils/logger");

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

// --- LOTTERY RECOVERY SYSTEM (RESTART + DELETION SAFE) ---
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
        if (!guild) {
          console.log(`⚠️ Guild not found: ${lottery.guildId}`);
          continue;
        }

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
        ) {
          console.log(`⚠️ Invalid or non-text channel: ${lottery.channelId}`);
          continue;
        }

        const embed = await buildLotteryEmbed(lottery.messageId, guild);
        if (!embed) {
          console.log(
            `⚠️ Lottery embed not found for message: ${lottery.messageId}`,
          );
          continue;
        }

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
          console.log(
            `♻️ Lottery message deleted. Reposted and recovered: ${message.id}`,
          );
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
  startTracking(client);

  // Recover active lotteries on startup
  await recoverLotteries();
});

// --- INTERACTIONS ---
client.on(Events.InteractionCreate, async (interaction) => {
  // --- Slash Commands ---
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

  // --- Button Clicks ---
  if (interaction.isButton()) {
    try {
      if (interaction.customId === "buy_ticket") {
        const TICKET_PRICE = 250;
        const LOTTERY_ROLE_ID = "1380456068685107301";

        const lottery = await Lottery.findOne({
          guildId: interaction.guild.id,
          isClosed: false,
        });
        if (!lottery) {
          return interaction.reply({
            content: "🛑 No active lottery found.",
            ephemeral: true,
          });
        }

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

        if (!updatedUser) {
          return interaction.editReply({ content: "❌ Insufficient gold." });
        }
        // --- ADD AUDIT LOG HERE ---
        await logToAudit(client, {
          userId: interaction.user.id,
          bet: TICKET_PRICE,
          amount: -TICKET_PRICE, // negative because user spent gold
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
          if (!member.roles.cache.has(LOTTERY_ROLE_ID)) {
            await member.roles.add(LOTTERY_ROLE_ID);
          }
        } catch (e) {}

        await interaction.editReply({
          content: "🎫 Ticket purchased successfully!",
        });

        // Refresh embed
        try {
          const channel = await interaction.guild.channels.fetch(
            lottery.channelId,
          );
          const msg = await channel.messages.fetch(lottery.messageId);
          const embed = await buildLotteryEmbed(
            lottery.messageId,
            interaction.guild,
          );

          const buttonRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("buy_ticket")
              .setLabel("🎟️ Buy Ticket (250 Gold)")
              .setStyle(ButtonStyle.Success),
          );

          if (embed)
            await msg
              .edit({ embeds: [embed], components: [buttonRow] })
              .catch(() => {});
        } catch (e) {}
      }

      // --- Open Modals ---
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

        modal.addComponents(new ActionRowBuilder().addComponents(amountInput));
        modal.addComponents(new ActionRowBuilder().addComponents(accountInput));

        await interaction.showModal(modal);
      }
    } catch (err) {
      console.error("Button Error:", err);
    }
  }

  // --- Modal Submissions ---
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
  }
});

// --- LOGIN ---
client.login(process.env.TOKEN);
