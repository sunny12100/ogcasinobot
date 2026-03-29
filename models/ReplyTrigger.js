const mongoose = require("mongoose");

const ReplyTriggerSchema = new mongoose.Schema({
  keyword: { type: String, required: true, unique: true },
  response: { type: String, required: true },
});

module.exports = mongoose.model("ReplyTrigger", ReplyTriggerSchema);
