const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const PassUser = require("../models/PassUser");
const crypto = require("crypto");

const activeDice = new Set();
const MAX_BET = 5000;

function randomFloat() {
  return crypto.randomBytes(4).readUInt32BE() / 2 ** 32;
}

function rollDie() {
  return crypto.randomInt(1, 7);
}

function rollDice() {
  return rollDie() + rollDie();
}

module.exports = {
  name: "vip-dice",
  async execute(interaction, repeatAmount = null) {
    const userId = interaction.user.id;
    const amount = repeatAmount ?? interaction.options?.getInteger?.("amount");
    const LOUNGE_ROLE = "1483219208962834473";

    if (!interaction.member.roles.cache.has(LOUNGE_ROLE)) {
      return interaction.reply({
        content: "🚫 This command is restricted.",
        ephemeral: true,
      });
    }

    if (!amount || amount <= 0 || amount > MAX_BET) {
      return interaction.reply({
        content: `❌ Bet must be between 1 and ${MAX_BET.toLocaleString()}.`,
        ephemeral: true,
      });
    }

    if (activeDice.has(userId)) {
      return interaction.reply({
        content: "❌ You are already rolling!",
        ephemeral: true,
      });
    }

    if (!interaction.deferred && !interaction.replied)
      await interaction.deferReply();

    try {
      // 1. ATOMIC CHECK & DEDUCT
      let data = await PassUser.findOneAndUpdate(
        { userId },
        { $setOnInsert: { userId } },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      );

      if (data.passBalance < amount) {
        return interaction.editReply({
          content: `❌ Insufficient balance! Current: \`${data.passBalance.toLocaleString()}\``,
        });
      }

      data = await PassUser.findOneAndUpdate(
        { userId, passBalance: { $gte: amount } },
        { $inc: { passBalance: -amount } },
        { new: true },
      );

      activeDice.add(userId);
      const failSafe = setTimeout(() => activeDice.delete(userId), 35000);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("higher")
          .setLabel("Higher")
          .setStyle(ButtonStyle.Success)
          .setEmoji("⬆️"),
        new ButtonBuilder()
          .setCustomId("lower")
          .setLabel("Lower")
          .setStyle(ButtonStyle.Danger)
          .setEmoji("⬇️"),
      );

      const initialEmbed = new EmbedBuilder()
        .setTitle("🎲 DOUBLE DICE")
        .setColor(0x5865f2)
        .setDescription(
          `👤 **Player:** <@${userId}>\n💰 **Bet:** \`${amount.toLocaleString()}\` gold\n\nChoose **Higher** or **Lower** to win a **2x** payout!`,
        );

      const msg = await interaction.editReply({
        embeds: [initialEmbed],
        components: [row],
      });
      const collector = msg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 20000,
      });

      collector.on("collect", async (i) => {
        if (i.user.id !== userId)
          return i.reply({ content: "Not your game!", ephemeral: true });
        collector.stop();

        await i.update({
          embeds: [
            new EmbedBuilder()
              .setTitle("🎲 ROLLING...")
              .setColor(0xffaa00)
              .setImage(
                "https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExbDg5MGR2czlqYzc5ZWljdXNtYTUxN295ZXBlcWdvbDF3aTB3aGF3ZiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/0mkK0hzJmL69KInkIZ/giphy.gif",
              ),
          ],
          components: [],
        });

        setTimeout(async () => {
          try {
            const won = randomFloat() < 0.5; // Clean 50/50 Odds
            let dealerRoll, userRoll;

            // Generate visuals to match the outcome
            do {
              dealerRoll = rollDice();
              userRoll = rollDice();
            } while (
              (won &&
                (i.customId === "higher"
                  ? userRoll <= dealerRoll
                  : userRoll >= dealerRoll)) ||
              (!won &&
                (i.customId === "higher"
                  ? userRoll > dealerRoll
                  : userRoll < dealerRoll)) ||
              userRoll === dealerRoll // Avoid ties for cleaner 50/50
            );

            const payout = won ? amount * 2 : 0;

            let updated = await PassUser.findOneAndUpdate(
              { userId },
              {
                $inc: {
                  passBalance: payout,
                  totalWagered: amount,
                  totalWon: won ? amount : 0,
                  totalLost: won ? 0 : amount,
                  gamesPlayed: 1,
                },
              },
              { new: true },
            );

            let statusText = "";
            if (updated.passBalance < 1) {
              updated = await PassUser.findOneAndUpdate(
                { userId },
                { $set: { passBalance: 50000 } },
                { new: true },
              );
              statusText = "\n\n*Reloaded 50,000 gold (Bust protection).*";
            }

            const resultEmbed = new EmbedBuilder()
              .setTitle(won ? "🎉 WINNER!" : "💀 HOUSE WINS")
              .setColor(won ? 0x2ecc71 : 0xe74c3c)
              .setDescription(
                `### Dealer: **${dealerRoll}** vs You: **${userRoll}**\n▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬\n💰 **Change:** \`${won ? "+" : "-"}${amount.toLocaleString()}\` gold\n🏦 **Balance:** \`${updated.passBalance.toLocaleString()}\` gold${statusText}`,
              );

            const repeatRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId("dice_rep")
                .setLabel("Roll Again")
                .setStyle(ButtonStyle.Success)
                .setDisabled(updated.passBalance < amount),
              new ButtonBuilder()
                .setCustomId("dice_quit")
                .setLabel("Quit")
                .setStyle(ButtonStyle.Secondary),
            );

            const finalMsg = await interaction.editReply({
              embeds: [resultEmbed],
              components: [repeatRow],
            });
            const endCollector = finalMsg.createMessageComponentCollector({
              componentType: ComponentType.Button,
              time: 10000,
            });

            endCollector.on("collect", async (btn) => {
              if (btn.user.id !== userId) return;
              activeDice.delete(userId);
              clearTimeout(failSafe);
              if (btn.customId === "dice_rep") {
                await btn.deferUpdate();
                return module.exports.execute(btn, amount);
              }
              await btn.update({ components: [] });
            });
          } catch (settleErr) {
            console.error(settleErr);
            await PassUser.updateOne(
              { userId },
              { $inc: { passBalance: amount } },
            );
          } finally {
            activeDice.delete(userId);
            clearTimeout(failSafe);
          }
        }, 2000);
      });

      collector.on("end", async (_, reason) => {
        if (reason === "time") {
          activeDice.delete(userId);
          clearTimeout(failSafe);
          await PassUser.updateOne(
            { userId },
            { $inc: { passBalance: amount } },
          );
          await interaction
            .editReply({
              content: "⏲️ **Timed Out:** Refunded.",
              embeds: [],
              components: [],
            })
            .catch(() => null);
        }
      });
    } catch (err) {
      activeDice.delete(userId);
      console.error(err);
    }
  },
};
