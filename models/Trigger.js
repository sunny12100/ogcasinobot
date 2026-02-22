const mongoose = require("mongoose");

const TriggerSchema = new mongoose.Schema({
  keyword: { type: String, required: true, unique: true },
  emojiId: { type: String, required: true },
});

module.exports = mongoose.model("Trigger", TriggerSchema);
