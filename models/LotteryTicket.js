const mongoose = require("mongoose");

const ticketSchema = new mongoose.Schema(
  {
    messageId: { type: String, required: true }, // which lottery
    userId: { type: String, required: true },
    username: { type: String, required: true },

    tickets: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// Prevent duplicate user entries per lottery
ticketSchema.index({ messageId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model("LotteryTicket", ticketSchema);
