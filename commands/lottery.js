const Lottery = require("../models/Lottery");
const LotteryTicket = require("../models/LotteryTicket");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} = require("discord.js");
const { buildLotteryEmbed } = require("../utils/lotteryEmbed");

const fs = require("fs");
const path = require("path");

const LOTTERY_CHANNEL_ID = process.env.LOTTERY_CHANNEL_ID;
const TICKET_PRICE = 250;

module.exports = {
  name: "start-lottery",
  async execute(interaction) {
    // --- ADMIN CHECK ---
    if (
      !interaction.member.permissions.has(PermissionFlagsBits.Administrator)
    ) {
      return interaction.reply({ content: "❌ Admin only.", ephemeral: true });
    }

    // --- PREVENT MULTIPLE ACTIVE LOTTERIES ---
    const existingLottery = await Lottery.findOne({
      guildId: interaction.guild.id,
      isClosed: false,
    });
    if (existingLottery) {
      return interaction.reply({
        content: "⚠️ A lottery is already active in this server.",
        ephemeral: true,
      });
    }

    const sponsorAmount = interaction.options.getInteger("sponsor") || 0;
    const durationMinutes = interaction.options.getInteger("duration") || 60;
    const endTime = Date.now() + durationMinutes * 60000;

    const lotteryChannel =
      interaction.guild.channels.cache.get(LOTTERY_CHANNEL_ID);
    if (!lotteryChannel) {
      return interaction.reply({
        content: "❌ Lottery channel not found.",
        ephemeral: true,
      });
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("buy_ticket")
        .setLabel("PURCHASE TICKET")
        .setStyle(ButtonStyle.Success)
        .setEmoji("🎫"),
    );

    await interaction.deferReply({ ephemeral: true });

    // --- PLACEHOLDER EMBED ---
    const placeholderEmbed = {
      title: "🎰 Deploying Lottery...",
      description: "Setting up OG Casino Lottery System...",
      color: 0xffd700,
    };

    const lotteryMsg = await lotteryChannel.send({
      embeds: [placeholderEmbed],
      components: [row],
    });

    // --- SAVE TO DATABASE ---
    const lotteryDoc = await Lottery.create({
      messageId: lotteryMsg.id,
      channelId: lotteryChannel.id,
      guildId: interaction.guild.id,
      poolBalance: sponsorAmount,
      totalTickets: 0,
      sponsorAmount: sponsorAmount,
      endTime: endTime,
      isClosed: false,
    });

    // --- BUILD FINAL EMBED ---
    const finalEmbed = await buildLotteryEmbed(
      lotteryMsg.id,
      interaction.guild,
    );
    if (finalEmbed) {
      await lotteryMsg.edit({ embeds: [finalEmbed], components: [row] });
    }

    await interaction.editReply({
      content: "✅ OG Casino Lottery deployed successfully.",
    });

    // --- AUTOMATIC TIMER ---
    setTimeout(async () => {
      try {
        // Mark lottery as closed
        await Lottery.updateOne({ _id: lotteryDoc._id }, { isClosed: true });

        // Refresh embed
        const endedEmbed = await buildLotteryEmbed(
          lotteryDoc.messageId,
          interaction.guild,
        );
        await lotteryMsg
          .edit({ embeds: [endedEmbed], components: [] })
          .catch(() => {});

        // Generate TXT report
        const ticketsData = await LotteryTicket.find({
          messageId: lotteryDoc.messageId,
        });
        const totalPool = lotteryDoc.poolBalance;
        let report = `💎 OG CASINO LOTTERY REPORT\n\n`;
        report += `Total Pool: ${totalPool} Gold\n`;
        report += `Sponsor Fund: ${lotteryDoc.sponsorAmount} Gold\n`;
        report += `Participants: ${ticketsData.length}\n\n`;
        report += `USERNAME | TICKETS PURCHASED\n`;
        report += `--------------------------\n`;
        ticketsData.forEach((t) => {
          report += `${t.username} | ${t.tickets}\n`;
        });

        const filePath = path.join(
          __dirname,
          `../lottery_report_${lotteryDoc.messageId}.txt`,
        );
        fs.writeFileSync(filePath, report, "utf-8");
        console.log(`📄 Lottery report saved: ${filePath}`);

        // Send TXT report to the channel
        await lotteryChannel.send({
          content: "🎰 Lottery ended! Participants report:",
          files: [filePath],
        });

        // Optional: Log payouts to audit (if winner selection implemented later)
        // ticketsData.forEach(async (t) => {
        //   await logToAudit(interaction.client, {
        //     userId: t.userId,
        //     bet: t.tickets * TICKET_PRICE,
        //     amount: 0, // update when winners are distributed
        //     oldBalance: null,
        //     newBalance: null,
        //     reason: `Lottery Ended [${lotteryDoc.messageId}]`,
        //   }).catch(() => null);
        // });
      } catch (err) {
        console.error("❌ Lottery End Timer Error:", err);
      }
    }, durationMinutes * 60000);
  },
};
