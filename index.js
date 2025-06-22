const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { OpenAI } = require('openai');

// Load environment variables from .env if present
require('dotenv').config();

const token = process.env.BOT_TOKEN;
const openaiKey = process.env.OPENAI_API_KEY;
const errorChannelId = process.env.ERROR_CHANNEL_ID;

if (!token || !openaiKey || !errorChannelId) {
  console.error('BOT_TOKEN, OPENAI_API_KEY and ERROR_CHANNEL_ID environment variables are required');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });
const openai = new OpenAI({ apiKey: openaiKey });

// Load persisted map of processed forwarded messages per chat.
// Structure: Map<chatId, Map<dedupKey, firstMessageId>>
const dedupFilePath = path.join(__dirname, 'forward_dedup.json');
const dedupStore = new Map();

try {
  const data = JSON.parse(fs.readFileSync(dedupFilePath, 'utf8'));
  for (const [chatId, keys] of Object.entries(data)) {
    const inner = new Map(Object.entries(keys));
    dedupStore.set(chatId, inner);
  }
} catch (e) {
  // No existing file or corrupted content - start fresh
}

function saveDedup() {
  const obj = {};
  for (const [chatId, map] of dedupStore) {
    obj[chatId] = Object.fromEntries(map);
  }
  fs.writeFileSync(dedupFilePath, JSON.stringify(obj));
}

bot.on('message', async (msg) => {
  if (!msg.chat || (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup')) {
    return;
  }

  try {
    if (msg.voice) {
      await handleVoice(msg);
    } else if (msg.forward_from || msg.forward_from_chat) {
      await handleForward(msg);
    }
  } catch (err) {
    await reportError(err, msg);
  }
});

async function handleVoice(msg) {
  const filePath = await bot.downloadFile(msg.voice.file_id, './');
  try {
    const response = await openai.audio.transcriptions.create({
      model: 'whisper-1',
      file: fs.createReadStream(path.resolve(filePath)),
      language: 'he'
    });
    await bot.sendMessage(msg.chat.id, response.text, { reply_to_message_id: msg.message_id });
  } finally {
    fs.unlink(filePath, () => {});
  }
}

async function handleForward(msg) {
  const text = msg.text || msg.caption || '';
  if (!text.trim()) return;

  // Build a key for deduplication using the original forward identifiers when available
  let key;
  if (msg.forward_from_chat && msg.forward_from_message_id) {
    key = `${msg.forward_from_chat.id}:${msg.forward_from_message_id}`;
  } else {
    key = crypto.createHash('sha256').update(text).digest('hex');
  }

  const chatKey = String(msg.chat.id);
  let map = dedupStore.get(chatKey);
  if (!map) {
    map = new Map();
    dedupStore.set(chatKey, map);
  }

  if (map.has(key)) {
    const firstId = map.get(key);
    // Create link to original message using channel-style link
    const chatLinkId = String(msg.chat.id).startsWith('-100')
      ? String(msg.chat.id).slice(4)
      : String(msg.chat.id).replace('-', '');
    const link = `https://t.me/c/${chatLinkId}/${firstId}`;
    const mention = msg.from.username ? `@${msg.from.username}` : `[${msg.from.first_name}](tg://user?id=${msg.from.id})`;
    await bot.deleteMessage(msg.chat.id, msg.message_id);
    await bot.sendMessage(msg.chat.id, `${mention} ההודעה כבר הועברה בעבר: ${link}`, { parse_mode: 'Markdown' });
    return;
  }

  const prompt = `Analyze the following message. If it is not mostly in Hebrew or English, first translate it to Hebrew. Then provide a short summary in Hebrew, removing credit tags, links or requests to follow or reply.\n\nMessage:\n${text}`;

  const result = await openai.chat.completions.create({
    model: 'gpt-4-turbo',
    messages: [{ role: 'user', content: prompt }]
  });

  const summary = result.choices[0].message.content.trim();
  await bot.sendMessage(msg.chat.id, summary, { reply_to_message_id: msg.message_id });

  map.set(key, msg.message_id);
  saveDedup();
}

async function reportError(error, msg) {
  const text = msg.text || msg.caption || '';
  const message = `Error handling message\nChat: ${msg.chat.id}\nContent: ${text}\nError: ${error.message}`;
  try {
    await bot.sendMessage(errorChannelId, message);
  } catch (e) {
    console.error('Failed to report error:', e);
  }
}
