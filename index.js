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
  EmbedBuilder, // Added for better UI
} = require("discord.js");
const fs = require("fs");
const path = require("path");
const { startTracking } = require("./checkTransactions");
const { loadUsers, saveUsers } = require("./utils/db");

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

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
      console.error(error);
      await interaction.reply({
        content: "❌ Error executing command.",
        ephemeral: true,
      });
    }
  }

  // 2. HANDLE BUTTON CLICKS
  if (interaction.isButton()) {
    if (interaction.customId === "open_register_modal") {
      const modal = new ModalBuilder()
        .setCustomId("register_modal")
        .setTitle("Account Registration");
      const usernameInput = new TextInputBuilder()
        .setCustomId("ttio_username")
        .setLabel("Territorial.io Account ID")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Enter your exact game Account ID (Example : XZZWE)")
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(usernameInput));
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
  }

  // 3. HANDLE MODAL SUBMISSIONS
  if (interaction.isModalSubmit()) {
    const users = loadUsers();
    const now = Date.now();
    // --- REGISTRATION SUBMISSION ---
    if (interaction.customId === "register_modal") {
      const ttioName = interaction.fields.getTextInputValue("ttio_username");

      // 1. Save to Database
      users[interaction.user.id] = {
        ttio: ttioName,
        verified: false,
        balance: users[interaction.user.id]?.balance || 0,
        registered_at: now,
        latest_tx_time: now,
      };
      saveUsers(users);

      // 2. ADD THE ROLE (ID Updated)
      const ROLE_ID = "1464514701596688524";
      const role = interaction.guild.roles.cache.get(ROLE_ID);

      if (role) {
        try {
          await interaction.member.roles.add(role);
        } catch (error) {
          console.error(
            "❌ Could not add role. Check bot permissions and hierarchy.",
            error,
          );
        }
      }

      await interaction.reply({
        content: `✅ **Success!** Linked to **${ttioName}** and granted the **${role ? role.name : "Casino Player"}** role.\nNow send gold to **XZZWE** in-game to verify your account.`,
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
      const userData = users[interaction.user.id];
      const target = customAccount || userData?.ttio;

      if (isNaN(amount) || amount <= 0)
        return interaction.reply({
          content: "❌ Please enter a valid number.",
          ephemeral: true,
        });
      if (!userData || !userData.verified)
        return interaction.reply({
          content: "❌ You must be verified to withdraw.",
          ephemeral: true,
        });
      if (userData.balance < amount)
        return interaction.reply({
          content: `❌ Insufficient balance! You only have **${userData.balance}** gold.`,
          ephemeral: true,
        });

      // --- IMPROVED MATH (3% Fee, Rounded Down) ---
      const fee = Math.floor(amount * 0.03);
      const receiveAmount = amount - fee;

      userData.balance -= amount;
      saveUsers(users);

      // --- IMPROVED DM UI (The Receipt) ---
      const receiptEmbed = new EmbedBuilder()
        .setTitle("📤 Withdrawal Requested")
        .setColor(0x3498db)
        .setThumbnail(interaction.user.displayAvatarURL())
        .setDescription(
          "Your payout request has been sent to our staff for processing.",
        )
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
        .setFooter({
          text: "If you don't receive gold in 24h, contact high staff.",
        })
        .setTimestamp();

      // Send the DM
      await interaction.user.send({ embeds: [receiptEmbed] }).catch(() => {
        console.log(`Failed to DM ${interaction.user.tag} (DMs likely closed)`);
      });

      // Log for Admin
      const logChannel = client.channels.cache.get(process.env.LOG_CHANNEL_ID);
      if (logChannel) {
        logChannel.send({
          content: `🚨 **NEW WITHDRAWAL**`,
          embeds: [
            new EmbedBuilder().setColor(0xffa500).addFields(
              {
                name: "User",
                value: `<@${interaction.user.id}>`,
                inline: true,
              },
              { name: "Target", value: `\`${target}\``, inline: true },
              { name: "Payout", value: `**${receiveAmount}**`, inline: true },
            ),
          ],
        });
      }

      await interaction.reply({
        content: `✅ **Request Sent!** You will receive **${receiveAmount}** gold shortly. Check your DMs for the receipt.`,
        ephemeral: true,
      });
    }
  }
});

client.login(process.env.TOKEN);
