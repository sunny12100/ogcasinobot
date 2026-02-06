require("dotenv").config();
const {
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
} = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check if the bot is alive"),

  new SlashCommandBuilder()
    .setName("balance")
    .addUserOption((opt) =>
      opt
        .setName("user")
        .setDescription("The person to view")
        .setRequired(false),
    )
    .setDescription("Check your casino balance"),

  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Create the registration and withdrawal panels")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("roulette")
    .setDescription("Start a roulette game")
    .addIntegerOption((option) =>
      option
        .setName("amount")
        .setDescription("Amount of gold to bet (50-500)")
        .setRequired(true)
        .setMinValue(50) // Updated to 25
        .setMaxValue(500),
    ),

  new SlashCommandBuilder()
    .setName("dice")
    .setDescription("Roll the dice against the House!")
    .addIntegerOption((opt) =>
      opt
        .setName("amount")
        .setDescription("Gold to bet (25-500)")
        .setRequired(true)
        .setMinValue(25) // Updated to 25
        .setMaxValue(500),
    ),

  new SlashCommandBuilder()
    .setName("slots")
    .setDescription("Try your luck on the OG Slots!")
    .addIntegerOption((opt) =>
      opt
        .setName("amount")
        .setDescription("Gold to bet (25-500)")
        .setRequired(true)
        .setMinValue(25) // Updated to 25
        .setMaxValue(500),
    ),

  new SlashCommandBuilder()
    .setName("coinflip")
    .setDescription("Bet on Heads or Tails!")
    .addIntegerOption((opt) =>
      opt
        .setName("amount")
        .setDescription("Gold to bet (25-500)")
        .setRequired(true)
        .setMinValue(25) // Updated to 25
        .setMaxValue(500),
    ),

  new SlashCommandBuilder()
    .setName("highlow")
    .setDescription("Guess if the next card is Higher or Lower!")
    .addIntegerOption((opt) =>
      opt
        .setName("amount")
        .setDescription("Gold to bet (50-500)")
        .setRequired(true)
        .setMinValue(50) // Updated to 25
        .setMaxValue(500),
    ),

  new SlashCommandBuilder()
    .setName("blackjack")
    .setDescription("Play a hand of Blackjack against the House!")
    .addIntegerOption((opt) =>
      opt
        .setName("amount")
        .setDescription("Gold to bet (50-200)")
        .setRequired(true)
        .setMinValue(50) // Updated to 25
        .setMaxValue(200),
    ),

  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("See the top 10 richest high-rollers in the server!"),

  new SlashCommandBuilder()
    .setName("aviator")
    .setDescription("Watch the plane climb! Cash out before it flies away.")
    .addIntegerOption((opt) =>
      opt
        .setName("amount")
        .setDescription("Gold to bet (100-200)")
        .setRequired(true)
        .setMinValue(100) // Updated to 25
        .setMaxValue(200),
    ),

  new SlashCommandBuilder()
    .setName("add-gold")
    .setDescription("Admin: Add gold to a user")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption((opt) =>
      opt
        .setName("user")
        .setDescription("The user to give gold to")
        .setRequired(true),
    )
    .addIntegerOption((opt) =>
      opt
        .setName("amount")
        .setDescription("Amount of gold")
        .setRequired(true)
        .setMinValue(1),
    ),

  new SlashCommandBuilder()
    .setName("remove-gold")
    .setDescription("Admin: Take gold from a user")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption((opt) =>
      opt
        .setName("user")
        .setDescription("The user to take gold from")
        .setRequired(true),
    )
    .addIntegerOption((opt) =>
      opt
        .setName("amount")
        .setDescription("Amount of gold")
        .setRequired(true)
        .setMinValue(1),
    ),

  new SlashCommandBuilder()
    .setName("pay")
    .setDescription("Transfer gold to another verified player")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("The person to pay").setRequired(true),
    )
    .addIntegerOption((opt) =>
      opt
        .setName("amount")
        .setDescription("Amount of gold to send")
        .setRequired(true)
        .setMinValue(1),
    ),

  new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Admin: View global economy statistics")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("rps")
    .setDescription("Challenge another player to Rock Paper Scissors for gold!")
    .addUserOption((opt) =>
      opt
        .setName("opponent")
        .setDescription("Who are you challenging?")
        .setRequired(true),
    )
    .addIntegerOption((opt) =>
      opt
        .setName("amount")
        .setDescription("Gold to bet")
        .setRequired(true)
        .setMinValue(1),
    ),
  new SlashCommandBuilder()
    .setName("poker")
    .setDescription("Play Texas Hold'em against the House bot!")
    .addIntegerOption((opt) =>
      opt
        .setName("amount")
        .setDescription("Gold to bet (50-300)")
        .setRequired(true)
        .setMinValue(50)
        .setMaxValue(300),
    ),
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("View the casino guide and game payouts"),

  // new SlashCommandBuilder()
  //   .setName("mines")
  //   .setDescription("Play Mines! Find gems and avoid the bombs.")
  //   .addIntegerOption((opt) =>
  //     opt
  //       .setName("amount")
  //       .setDescription("Gold to bet (25-200)")
  //       .setRequired(true)
  //       .setMinValue(25) // Updated to 25
  //       .setMaxValue(200),
  //   )
  //   .addIntegerOption((opt) =>
  //     opt
  //       .setName("mines")
  //       .setDescription("Number of mines to hide (6-19)")
  //       .setRequired(false)
  //       .setMinValue(6)
  //       .setMaxValue(19),
  //   ),

  new SlashCommandBuilder()
    .setName("horserace")
    .setDescription("Bet on a horse race!")
    .addIntegerOption((opt) =>
      opt
        .setName("amount")
        .setDescription("Gold to bet (100-500)")
        .setRequired(true)
        .setMinValue(100) // Updated to 25
        .setMaxValue(500),
    )
    .addStringOption((opt) =>
      opt
        .setName("horse")
        .setDescription("Pick your champion")
        .setRequired(true)
        .addChoices(
          { name: "OG (Red)", value: "OG" },
          { name: "SYNDICATE (Blue)", value: "SYNDICATE" },
          { name: "TITAN (Green)", value: "TITAN" },
          { name: "IND (Yellow)", value: "IND" },
        ),
    ),
  new SlashCommandBuilder()
    .setName("mod-stats") // <--- NEW COMMAND ADDED HERE
    .setDescription("Admin: View moderator workload and activity logs")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
].map((cmd) => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

(async () => {
  try {
    console.log("🔄 Updating command list with 25-500 limits...");

    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID,
      ),
      { body: commands },
    );
    console.log("✅ Commands updated! Minimum bet is now 25.");
  } catch (err) {
    console.error(err);
  }
})();
