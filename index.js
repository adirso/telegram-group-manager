const TelegramBot = require('node-telegram-bot-api');
const { spawn } = require('child_process');

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('BOT_TOKEN environment variable is required');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

bot.on('message', (msg) => {
  // Listen to any message in a group
  if (msg.chat && (msg.chat.type === 'group' || msg.chat.type === 'supergroup')) {
    // Check if the message is a forwarded message
    if (msg.forward_from || msg.forward_from_chat) {
      // Start the ManageMessage process
      spawn('ManageMessage', [], { stdio: 'inherit' });
    }
  }
});
