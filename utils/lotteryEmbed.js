const { EmbedBuilder } = require("discord.js");
const Lottery = require("../models/Lottery");
const LotteryTicket = require("../models/LotteryTicket");

const TICKET_PRICE = 250;
const WINNER_ROLE_ID = "1380457828837359691";

async function buildLotteryEmbed(messageId, guild) {
  const lotteryData = await Lottery.findOne({ messageId });
  if (!lotteryData) return null;

  const ticketsData = await LotteryTicket.find({ messageId });

  const totalTickets = lotteryData.totalTickets || 0;
  const poolBalance = lotteryData.poolBalance || 0;
  const sponsorAmount = lotteryData.sponsorAmount || 0;
  const isClosed = lotteryData.isClosed;
  const endTime = lotteryData.endTime;

  const p1 = Math.floor(poolBalance * 0.5);
  const p2 = Math.floor(poolBalance * 0.3);
  const p3 = Math.floor(poolBalance * 0.2);
  const endsUnix = Math.floor(endTime / 1000);
  const header = isClosed ? "🛑 LOTTERY CLOSED" : "🎰 MEGA LOTTERY ACTIVE";

  const topBuyers = ticketsData
    .sort((a, b) => b.tickets - a.tickets)
    .slice(0, 3);

  let topPanel = "```yaml\n";
  if (topBuyers.length === 0) {
    topPanel += "No tickets purchased yet\n";
  } else {
    topBuyers.forEach((user, index) => {
      const rank = ["🥇", "🥈", "🥉"][index] || "▫️";
      topPanel += `${rank} ${user.username} : ${user.tickets} tickets\n`;
    });
  }
  topPanel += "```";

  return new EmbedBuilder()
    .setColor(isClosed ? 0x8b0000 : 0xffd700)
    .setTitle("💎 OG CASINO • MEGA LOTTERY")
    .setDescription(
      [
        "```fix",
        "HIGH RISK • HIGH REWARD • LUXURY DRAW",
        "```",
        "",
        `🎟️ **Ticket Price:** \`${TICKET_PRICE.toLocaleString()} Gold\``,
      ].join("\n"),
    )
    .addFields(
      {
        name: "💰 JACKPOT VAULT",
        value:
          "```yaml\n" +
          `Total Pool   : ${poolBalance.toLocaleString()} Gold\n` +
          `Sponsor Fund : ${sponsorAmount.toLocaleString()} Gold\n` +
          "```",
      },
      {
        name: "🏆 PRIZE TIERS",
        value:
          "```css\n" +
          `🥇 First Place (50%) : ${p1.toLocaleString()} Gold\n` +
          `🥈 Second Place (30%) : ${p2.toLocaleString()} Gold\n` +
          `🥉 Third Place (20%) : ${p3.toLocaleString()} Gold\n` +
          "```" +
          `\n👑 Winner Role: <@&${WINNER_ROLE_ID}>`,
      },
      {
        name: "📊 LOTTERY TERMINAL",
        value:
          "```ini\n" +
          `Tickets Sold = ${totalTickets}\n` +
          `Participants = ${ticketsData.length}\n` +
          `Status = ${header}\n` +
          "```",
      },
      {
        name: "🏅 TOP BUYERS",
        value: topPanel,
      },
      {
        name: "⏳ DRAW TIMER",
        value: isClosed
          ? "```diff\n- LOTTERY HAS ENDED\n```"
          : `🕒 **Draw Ends:** <t:${endsUnix}:R>`,
      },
    )
    .setThumbnail(guild.iconURL({ dynamic: true, size: 512 }))
    .setFooter({
      text: isClosed
        ? "OG Casino System • Manifest Generated"
        : "OG Casino System • Persistent Ticket System Enabled",
      iconURL: guild.iconURL({ dynamic: true }),
    });
}

module.exports = { buildLotteryEmbed };
