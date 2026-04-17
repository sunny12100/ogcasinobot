const mongoose = require("mongoose");

const matchSchema = new mongoose.Schema({
  matchId: { type: String, default: "current" }, // We only track one active match at a time
  teamA: String,
  teamB: String,
  potA: { type: Number, default: 0 },
  potB: { type: Number, default: 0 },
  bets: [
    {
      userId: String,
      team: String,
      amount: Number,
    },
  ],
  status: { type: String, enum: ["OPEN", "ONGOING", "ENDED"], default: "OPEN" },
  messageId: String, // To edit the panel later
  channelId: String,
});

module.exports = mongoose.model("Match", matchSchema);
