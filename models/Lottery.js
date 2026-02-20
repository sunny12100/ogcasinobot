const mongoose = require("mongoose");

const lotterySchema = new mongoose.Schema(
  {
    messageId: { type: String, required: true, unique: true }, // lottery message
    guildId: { type: String, required: true },

    poolBalance: { type: Number, default: 0 },
    totalTickets: { type: Number, default: 0 },
    sponsorAmount: { type: Number, default: 0 },

    endTime: { type: Number, required: true },
    isClosed: { type: Boolean, default: false },
  },
  { timestamps: true },
);
lotterySchema.index(
  { guildId: 1, isClosed: 1 },
  { unique: true, partialFilterExpression: { isClosed: false } },
);
module.exports = mongoose.model("Lottery", lotterySchema);
