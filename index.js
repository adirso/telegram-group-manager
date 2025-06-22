const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');

const token = process.env.BOT_TOKEN;
const openaiKey = process.env.OPENAI_API_KEY;
const errorChannelId = process.env.ERROR_CHANNEL_ID;

if (!token || !openaiKey || !errorChannelId) {
  console.error('BOT_TOKEN, OPENAI_API_KEY and ERROR_CHANNEL_ID environment variables are required');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });
const openai = new OpenAI({ apiKey: openaiKey });

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

  const prompt = `Analyze the following message. If it is not mostly in Hebrew or English, first translate it to Hebrew. Then provide a short summary in Hebrew, removing credit tags, links or requests to follow or reply.\n\nMessage:\n${text}`;

  const result = await openai.chat.completions.create({
    model: 'gpt-4-turbo',
    messages: [{ role: 'user', content: prompt }]
  });

  const summary = result.choices[0].message.content.trim();
  await bot.sendMessage(msg.chat.id, summary, { reply_to_message_id: msg.message_id });
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
