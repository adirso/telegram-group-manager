# Telegram Group Manager

This bot handles voice messages and forwarded messages in Telegram groups. Voice messages are transcribed using OpenAI Whisper. Forwarded messages are summarized in Hebrew using GPT-4.

When a forwarded message arrives, the bot deletes the forwarded copy and posts a new message containing the Hebrew summary. The new message mentions the user who forwarded it and, when possible, links back to the original message.

## Configuration

Copy `.env.example` to `.env` and fill in the `BOT_TOKEN`, `OPENAI_API_KEY` and `ERROR_CHANNEL_ID` values. The application uses [dotenv](https://github.com/motdotla/dotenv) to automatically load these variables at startup.

## Forwarded message deduplication

The bot keeps track of processed forwarded messages for each chat. When a forwarded message arrives, a unique key is built from the original chat and message ID when available, falling back to a hash of the text.

If the message was already processed in that chat, the new copy is deleted and the sender is tagged with a link to the first appearance. Otherwise the message is summarized and recorded. The data is persisted to `forward_dedup.json` so deduplication survives restarts.
