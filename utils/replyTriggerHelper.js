const ReplyTrigger = require("../models/ReplyTrigger");

let replyCache = new Map();

async function updateReplyCache() {
  try {
    const data = await ReplyTrigger.find();

    replyCache.clear();

    for (const item of data) {
      replyCache.set(item.keyword.toLowerCase(), item.response);
    }

    console.log(`💬 Reply Cache Updated: ${replyCache.size} loaded.`);
  } catch (err) {
    console.error("❌ Reply Cache Error:", err);
  }
}

function getReplyCache() {
  return replyCache;
}

module.exports = { updateReplyCache, getReplyCache };
