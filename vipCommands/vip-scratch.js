const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  SlashCommandBuilder,
} = require("discord.js");
const PassUser = require("../models/PassUser");

const activeVipScratch = new Map();
const SESSION_EXPIRY = 45000;

// Cleanup stale sessions
setInterval(() => {
  const now = Date.now();
  for (const [id, ts] of activeVipScratch) {
    if (now - ts > SESSION_EXPIRY) activeVipScratch.delete(id);
  }
}, 30000);

module.exports = {
  data: new SlashCommandBuilder()
    .setName("vip-scratch")
    .setDescription("💎 VIP LOUNGE: Scratch Cards ")
    .addIntegerOption((opt) =>
      opt
        .setName("amount")
        .setDescription("Card price (1-10,000)")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(10000),
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const amount = interaction.options.getInteger("amount");
    const LOUNGE_ROLE = "1483219208962834473";

    if (!interaction.member.roles.cache.has(LOUNGE_ROLE)) {
      return interaction.reply({
        content: "🚫 Restricted to OG Pass holders!",
        ephemeral: true,
      });
    }

    if (activeVipScratch.has(userId)) {
      return interaction.reply({
        content: "❌ Finish your current card first!",
        ephemeral: true,
      });
    }

    await interaction.deferReply();
    activeVipScratch.set(userId, Date.now());

    let userData;
    try {
      // 1. Deduction & VIP Reload (Bust Protection)
      userData = await PassUser.findOneAndUpdate(
        { userId, passBalance: { $gte: amount } },
        { $inc: { passBalance: -amount, totalLost: amount, gamesPlayed: 1 } },
        { new: true },
      );

      if (!userData) {
        userData = await PassUser.findOneAndUpdate(
          { userId },
          { $set: { passBalance: 50000 }, $inc: { gamesPlayed: 1 } },
          { upsert: true, new: true },
        );
        userData = await PassUser.findOneAndUpdate(
          { userId },
          { $inc: { passBalance: -amount, totalLost: amount } },
          { new: true },
        );
      }
    } catch (err) {
      activeVipScratch.delete(userId);
      return interaction.editReply("❌ Database error. Try again.");
    }

    const getGrid = (revealedPos = null, emoji = null, nearMisses = []) => {
      const rows = [];
      for (let i = 0; i < 5; i++) {
        const row = new ActionRowBuilder();
        for (let j = 0; j < 5; j++) {
          const btnId = `vip_scr_${i}_${j}`;
          const btn = new ButtonBuilder().setCustomId(btnId);
          const miss = nearMisses.find((m) => m.pos === btnId);

          if (revealedPos === btnId) {
            btn
              .setLabel(emoji)
              .setStyle(
                emoji === "❌" ? ButtonStyle.Danger : ButtonStyle.Success,
              )
              .setDisabled(true);
          } else if (miss) {
            btn
              .setLabel(miss.icon)
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(true);
          } else {
            btn
              .setLabel("💎")
              .setStyle(ButtonStyle.Primary)
              .setDisabled(revealedPos !== null);
          }
          row.addComponents(btn);
        }
        rows.push(row);
      }
      return rows;
    };

    const embed = new EmbedBuilder()
      .setTitle("💎 VIP ELITE SCRATCHER")
      .setColor(0x00ffff)
      .setDescription(
        `### Choose ONE tile!\n${"▬".repeat(22)}\n\` 🌟 Jackpot: 25x | 🎫 Winner: 3x | ❌ Loss: 0x \``,
      )
      .addFields({
        name: "💳 VIP WALLET",
        value: `**${userData.passBalance.toLocaleString()}** gold`,
        inline: true,
      })
      .setFooter({ text: `VIP Card Value: ${amount.toLocaleString()} Gold` });

    const msg = await interaction.editReply({
      embeds: [embed],
      components: getGrid(),
    });

    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: SESSION_EXPIRY,
    });

    collector.on("collect", async (i) => {
      if (i.user.id !== userId)
        return i.reply({ content: "Not your card!", ephemeral: true });

      collector.stop("scratched");
      let settled = false;

      try {
        const rng = Math.random() * 100;
        let mult = 0,
          emoji = "❌",
          status = "BETTER LUCK NEXT TIME",
          color = 0xe74c3c;

        // HIGH RTP: 5% Jackpot, 35% Ticket Win (~230% RTP)
        if (rng < 5) {
          mult = 25;
          emoji = "🌟";
          status = "💎 MEGA VIP JACKPOT!";
          color = 0xf1c40f;
        } else if (rng < 40) {
          mult = 3;
          emoji = "🎫";
          status = "✅ VIP WINNER!";
          color = 0x2ecc71;
        }

        const [r, c] = i.customId.split("_").slice(2).map(Number);
        const nearMisses = [];
        const allSpots = [];

        for (let ri = 0; ri < 5; ri++) {
          for (let ci = 0; ci < 5; ci++) {
            if (ri !== r || ci !== c) allSpots.push({ r: ri, c: ci });
          }
        }
        allSpots.sort(() => Math.random() - 0.5);

        // Tease logic
        const jp = allSpots.pop();
        nearMisses.push({ pos: `vip_scr_${jp.r}_${jp.c}`, icon: "🌟" });
        for (let k = 0; k < 4; k++) {
          const p = allSpots.pop();
          nearMisses.push({ pos: `vip_scr_${p.r}_${p.c}`, icon: "🎫" });
        }

        const payout = amount * mult;
        const net = payout - amount;

        const finalUser = await PassUser.findOneAndUpdate(
          { userId },
          { $inc: { passBalance: payout, totalWon: payout } },
          { new: true },
        );
        settled = true;

        const resultEmbed = new EmbedBuilder()
          .setTitle(`🎫 Result: ${status}`)
          .setColor(color)
          .addFields(
            {
              name: "💰 VIP PAYOUT",
              value: `\`\`\`diff\n+ Payout: ${payout.toLocaleString()}\n${net >= 0 ? "+" : ""} Profit: ${net.toLocaleString()}\n\`\`\``,
              inline: true,
            },
            {
              name: "💳 BALANCE",
              value: `**${finalUser.passBalance.toLocaleString()}** gold`,
              inline: true,
            },
          );

        await i.update({
          embeds: [resultEmbed],
          components: getGrid(i.customId, emoji, nearMisses),
        });
      } catch (err) {
        if (!settled)
          await PassUser.updateOne(
            { userId },
            { $inc: { passBalance: amount } },
          );
      } finally {
        activeVipScratch.delete(userId);
      }
    });

    collector.on("end", async (collected, reason) => {
      if (reason === "time" && collected.size === 0) {
        activeVipScratch.delete(userId);
        await PassUser.updateOne({ userId }, { $inc: { passBalance: amount } });
        try {
          await interaction.editReply({
            content: "⏱️ **VIP Card Expired.** Gold returned.",
            embeds: [],
            components: [],
          });
        } catch {}
      }
    });
  },
};
