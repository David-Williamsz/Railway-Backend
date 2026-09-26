import fetch from 'node-fetch';

const TELEGRAM_API_BASE = 'https://api.telegram.org';

function apiUrl(method) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN is not set.');
  }
  return `${TELEGRAM_API_BASE}/bot${token}/${method}`;
}

/**
 * Sends a plain text message. Kept deliberately simple — this file knows
 * nothing about conversation state, AI, or business logic. It only knows
 * how to talk to Telegram's API.
 */
export async function sendMessage(chatId, text, options = {}) {
  const response = await fetch(apiUrl('sendMessage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_markup: options.replyMarkup
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram sendMessage failed: ${body}`);
  }

  return response.json();
}

/**
 * Builds an inline keyboard from semantic action identifiers — never from
 * button label text. The label is what the user sees; callback_data is
 * what the code reads. Changing a label never breaks the logic that
 * handles it.
 */
export function buildInlineKeyboard(buttons) {
  // buttons: [{ label: "Talk to Michael", action: "talk_to_michael" }, ...]
  return {
    inline_keyboard: [
      buttons.map((b) => ({ text: b.label, callback_data: b.action }))
    ]
  };
}

/**
 * Parses an incoming Telegram webhook update into a normalized shape the
 * conversation engine can use, without needing to know Telegram's exact
 * payload structure.
 */
export function parseUpdate(update) {
  if (update.callback_query) {
    return {
      type: 'callback_action',
      chatId: update.callback_query.message.chat.id,
      telegramUserId: String(update.callback_query.from.id),
      telegramUsername: update.callback_query.from.username || null,
      action: update.callback_query.data
    };
  }

  if (update.message?.text) {
    return {
      type: 'text',
      chatId: update.message.chat.id,
      telegramUserId: String(update.message.from.id),
      telegramUsername: update.message.from.username || null,
      text: update.message.text
    };
  }

  return null; // unsupported update type (photo, sticker, etc.) — ignored in v1
}
