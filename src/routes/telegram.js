import express from 'express';
import { parseUpdate, sendMessage } from '../services/telegram.js';
import { handleIncomingMessage, handleCallbackAction } from '../services/conversationEngine.js';
import { logAction } from '../utils/logger.js';

export const telegramRouter = express.Router();

/**
 * POST /api/telegram/webhook
 *
 * Like the NOWPayments webhook, this has no admin session — Telegram's
 * servers call it directly. Telegram doesn't sign requests the way
 * NOWPayments does; the standard mitigation is a secret path segment
 * (set when registering the webhook URL with Telegram) so the endpoint
 * isn't guessable. Set TELEGRAM_WEBHOOK_SECRET and register the webhook
 * URL as /api/telegram/webhook/<secret>.
 */
telegramRouter.post('/webhook/:secret', express.json(), async (req, res) => {
  if (req.params.secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return res.status(404).send('Not found');
  }

  // Acknowledge immediately — Telegram expects a fast response and will
  // retry if it doesn't get one. Processing happens after responding.
  res.status(200).send('OK');

  try {
    const parsed = parseUpdate(req.body);
    if (!parsed) return; // unsupported update type — ignored

    if (parsed.type === 'text') {
      const replies = await handleIncomingMessage({
        telegramUserId: parsed.telegramUserId,
        telegramUsername: parsed.telegramUsername,
        text: parsed.text
      });
      for (const reply of replies) {
        await sendMessage(parsed.chatId, reply);
      }
    }

    if (parsed.type === 'callback_action') {
      const reply = await handleCallbackAction({
        telegramUserId: parsed.telegramUserId,
        action: parsed.action
      });
      if (reply) {
        await sendMessage(parsed.chatId, reply);
      }
    }
  } catch (err) {
    logAction('telegram.webhook_error', { error: err.message });
  }
});
