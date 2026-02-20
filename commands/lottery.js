const Lottery = require("../models/Lottery");
const LotteryTicket = require("../models/LotteryTicket");
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  PermissionFlagsBits,
  AttachmentBuilder,
} = require("discord.js");
const User = require("../models/User");
const fs = require("fs");

const LOTTERY_CHANNEL_ID = "1464892189783101574";
const LOTTERY_ROLE_ID = "1380456068685107301";
const WINNER_ROLE_ID = "1380457828837359691";
const TICKET_PRICE = 250;

// Anti-spam cooldown
const clickCooldown = new Set();

module.exports = {
  name: "start-lottery",
  async execute(interaction) {
    if (
      !interaction.member.permissions.has(PermissionFlagsBits.Administrator)
    ) {
      return interaction.reply({ content: "❌ Admin only.", ephemeral: true });
    }

    // 🛑 Prevent multiple active lotteries (IMPORTANT)
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

    let totalTickets = 0;
    let poolBalance = sponsorAmount;
    let isClosed = false;
    const participants = new Map();

    const mainEmbed = () => {
      const p1 = Math.floor(poolBalance * 0.5);
      const p2 = Math.floor(poolBalance * 0.3);
      const p3 = Math.floor(poolBalance * 0.2);
      const endsUnix = Math.floor(endTime / 1000);
      const header = isClosed ? "🛑 LOTTERY CLOSED" : "🎰 MEGA LOTTERY ACTIVE";

      const topBuyers = [...participants.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, 3);

      let topPanel = "```yaml\n";
      if (topBuyers.length === 0) {
        topPanel += "No tickets purchased yet\n";
      } else {
        topBuyers.forEach((user, index) => {
          const rank = ["🥇", "🥈", "🥉"][index] || "▫️";
          topPanel += `${rank} ${user.tag} : ${user.count} tickets\n`;
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
            inline: false,
          },
          {
            name: "🏆 PRIZE TIERS",
            value:
              "```css\n" +
              `🥇 First Place (50%) : ${p1.toLocaleString()} Gold + <@${WINNER_ROLE_ID}>\n` +
              `🥈 Second Place (30%) : ${p2.toLocaleString()} Gold\n` +
              `🥉 Third Place (20%) : ${p3.toLocaleString()} Gold\n` +
              "```",
            inline: false,
          },
          {
            name: "📊 LOTTERY TERMINAL",
            value:
              "```ini\n" +
              `Tickets Sold = ${totalTickets}\n` +
              `Participants = ${participants.size}\n` +
              `Status = ${header}\n` +
              "```",
            inline: false,
          },
          {
            name: "🏅 TOP BUYERS",
            value: topPanel,
            inline: false,
          },
          {
            name: "⏳ DRAW TIMER",
            value: isClosed
              ? "```diff\n- LOTTERY HAS ENDED\n```"
              : `🕒 **Draw Ends:** <t:${endsUnix}:R>`,
            inline: false,
          },
        )
        .setThumbnail(interaction.guild.iconURL({ dynamic: true, size: 512 }))
        .setFooter({
          text: isClosed
            ? "OG Casino System • Manifest Generated"
            : "OG Casino System • Secure Ticket Logging Enabled",
          iconURL: interaction.guild.iconURL({ dynamic: true }),
        });
    };

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("buy_ticket")
        .setLabel("PURCHASE TICKET")
        .setStyle(ButtonStyle.Success)
        .setEmoji("🎫"),
    );

    const lotteryChannel =
      interaction.guild.channels.cache.get(LOTTERY_CHANNEL_ID);
    if (!lotteryChannel) {
      return interaction.reply({
        content: "❌ Channel not found.",
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });
    await interaction.editReply({
      content: "✅ OG Lottery deployed.",
    });

    const lotteryMsg = await lotteryChannel.send({
      embeds: [mainEmbed()],
      components: [row],
    });

    // ✅ SAVE LOTTERY TO MONGODB (CRASH-SAFE)
    await Lottery.create({
      messageId: lotteryMsg.id,
      guildId: interaction.guild.id,
      poolBalance: sponsorAmount,
      totalTickets: 0,
      sponsorAmount: sponsorAmount,
      endTime: endTime,
      isClosed: false,
    });

    const updateInterval = setInterval(async () => {
      if (Date.now() >= endTime || isClosed) {
        return clearInterval(updateInterval);
      }
      await lotteryMsg.edit({ embeds: [mainEmbed()] }).catch(() => {
        clearInterval(updateInterval);
      });
    }, 30000);

    const collector = lotteryMsg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: durationMinutes * 60000,
    });

    collector.on("collect", async (i) => {
      if (isClosed) {
        return i.reply({
          content: "🛑 Lottery has already ended.",
          ephemeral: true,
        });
      }

      if (clickCooldown.has(i.user.id)) {
        return i.reply({
          content: "⏳ Slow down! Processing your ticket...",
          ephemeral: true,
        });
      }

      clickCooldown.add(i.user.id);
      setTimeout(() => clickCooldown.delete(i.user.id), 1200);

      await i.deferReply({ ephemeral: true });

      const updatedUser = await User.findOneAndUpdate(
        {
          userId: i.user.id,
          gold: { $gte: TICKET_PRICE },
        },
        {
          $inc: { gold: -TICKET_PRICE },
        },
        { new: true },
      );

      if (!updatedUser) {
        return i.editReply({
          content: "❌ Insufficient gold.",
        });
      }

      const displayName = i.user.globalName || i.user.username;

      // ✅ UPDATE LOTTERY STATS IN DB
      await Lottery.findOneAndUpdate(
        { messageId: lotteryMsg.id },
        {
          $inc: {
            totalTickets: 1,
            poolBalance: TICKET_PRICE,
          },
        },
      );

      // ✅ SAVE USER TICKETS (CRASH PROOF)
      await LotteryTicket.findOneAndUpdate(
        {
          messageId: lotteryMsg.id,
          userId: i.user.id,
        },
        {
          $inc: { tickets: 1 },
          $setOnInsert: {
            username: displayName,
          },
        },
        { upsert: true },
      );

      // 🔁 Keep memory for fast live embed (no visual lag)
      totalTickets++;
      poolBalance += TICKET_PRICE;

      const current = participants.get(i.user.id) || {
        tag: displayName,
        count: 0,
      };

      participants.set(i.user.id, {
        tag: displayName,
        count: current.count + 1,
      });

      try {
        const member = await i.guild.members.fetch(i.user.id);
        if (!member.roles.cache.has(LOTTERY_ROLE_ID)) {
          await member.roles.add(LOTTERY_ROLE_ID);
        }
      } catch (err) {
        console.error("Role Error:", err);
      }

      await i.editReply({
        content: "🎫 Ticket purchased successfully!",
      });

      await lotteryMsg.edit({ embeds: [mainEmbed()] });
    });

    collector.on("end", async () => {
      isClosed = true;
      clearInterval(updateInterval);

      // ✅ MARK LOTTERY AS CLOSED IN DB
      await Lottery.findOneAndUpdate(
        { messageId: lotteryMsg.id },
        { isClosed: true },
      );

      await lotteryMsg.edit({
        embeds: [mainEmbed()],
        components: [],
      });

      if (participants.size === 0) {
        return lotteryChannel.send(
          "🛑 **Lottery Ended:** No entries recorded.",
        );
      }

      let fileContent = `==========================================\n`;
      fileContent += `    OG CASINO LOTTERY FINAL MANIFEST      \n`;
      fileContent += `==========================================\n`;
      fileContent += `Date: ${new Date().toLocaleString()}\n`;
      fileContent += `Total Jackpot: ${poolBalance} Gold\n`;
      fileContent += `Total Tickets Sold: ${totalTickets}\n`;
      fileContent += `Total Participants: ${participants.size}\n`;
      fileContent += `------------------------------------------\n\n`;
      fileContent += `PARTICIPANT LIST:\n`;

      participants.forEach((data, id) => {
        fileContent += `[-] User: ${data.tag.padEnd(
          25,
        )} | ID: ${id} | Tickets: ${data.count}\n`;
      });

      const fileName = `lottery-manifest-${Date.now()}.txt`;
      fs.writeFileSync(fileName, fileContent);

      const attachment = new AttachmentBuilder(fileName);

      await lotteryChannel.send({
        content: `📑 **Lottery manifest for manual draw attached.**`,
        files: [attachment],
      });

      fs.unlinkSync(fileName);
    });
  },
};
