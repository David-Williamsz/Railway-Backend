# Michael's Backend (Railway)

Trusted backend for admin actions and the NOWPayments webhook. Runs on
Railway instead of Firebase Cloud Functions because Cloud Functions with
outbound calls require Firebase's Blaze (paid) plan — see project notes.
Firestore and Auth remain fully on Firebase's free Spark plan; only the
*compute* moved to Railway.

## What's here (Phase: payment lifecycle, smallest working slice first)

- `POST /api/admin/payment-requests` — admin creates an invoice for an
  agreed price. Requires a valid Firebase ID token belonging to an admin.
- `POST /api/admin/payment-requests/:id/fulfill` — admin marks a completed
  payment as fulfilled. Refuses unless the payment's provider status is
  actually `finished`.
- `POST /api/webhooks/nowpayments` — NOWPayments' server calls this
  directly. No admin session involved; security rests entirely on
  signature verification.
- `GET /health` — plain liveness check for Railway.

## How each safeguard is implemented here

| Safeguard | Where |
|---|---|
| 1. Auth + authorization | `middleware/requireAdmin.js` — verifies the Firebase ID token, then independently checks `admins/{uid}` in Firestore. Being logged in is not enough. |
| 2. Input validation | Explicit type/value checks at the top of each admin route — nothing from `req.body` is trusted by shape alone. |
| 3. State-transition ownership | `fulfill` only ever writes `fulfillmentStatus`. The webhook only ever writes `status`. Neither route touches the other's field. |
| 4. Idempotency | Invoice creation happens against a Firestore doc ID used as NOWPayments' `order_id`. The webhook checks `providerPaymentId` + `status` before reprocessing a redelivered event. |
| 5. Signature verification | `services/nowpayments.js` — HMAC-SHA512 over NOWPayments' documented sorted-JSON canonicalization, compared with `crypto.timingSafeEqual`. |
| 6. Logging | `utils/logger.js` — structured, and strips any key that looks like a secret before it's ever logged. |

## Setup

1. **Firebase service account**: Firebase console → Project settings →
   Service accounts → "Generate new private key". Paste the full JSON as
   one line into Railway's `FIREBASE_SERVICE_ACCOUNT_JSON` variable — do
   this once per environment (test project's key → test Railway service,
   prod project's key → prod Railway service). Never commit this file.
2. **Railway variables**: copy every key from `.env.example` into
   Railway's project → Variables tab. Set `PUBLIC_BASE_URL` to the
   `https://...up.railway.app` URL Railway assigns your service (needed so
   the invoice-creation code can tell NOWPayments where to send webhooks).
3. **NOWPayments dashboard**: no webhook URL needs setting there — it's
   passed per-invoice in the `ipn_callback_url` field when the invoice is
   created.
4. **Deploy**: connect this repo to a Railway service. Railway auto-detects
   Node and runs `npm start`.
5. **Verify**: hit `https://your-service.up.railway.app/health` — should
   return `{"status":"ok","env":"test"}` (or `"production"`).

## Testing before connecting the admin UI

```
npm install
npm test
```

This runs the signature-verification unit tests — pure functions, no
emulator needed. They cover: valid signature, wrong secret, tampered
payload, missing signature, and key-order independence (since NOWPayments'
algorithm sorts keys, a real webhook's field order shouldn't matter, and a
test proves that rather than assuming it).

**Not yet covered here, worth doing manually before going live:**
unauthorized request to an admin route (no token → 401, wrong-user token →
403), and a full manual test invoice through NOWPayments' sandbox to watch
a real webhook arrive and update Firestore correctly.

## Telegram bot (now included)

- `bot-config/` — voice.md, knowledge.md, behavior.md: the bot's actual
  personality/knowledge/rules, kept as editable data, not buried in code.
  Built from Michael's real, unfiltered writing samples — never from
  AI-assisted text or his old client conversations (see voice.md's source
  note for why).
- `src/services/groq.js` — LLM reliability wrapper (bounded retries,
  Retry-After handling, observability, user-facing fallback on failure).
- `src/services/telegram.js` — pure transport: send messages, parse
  incoming updates, build inline keyboards from semantic action IDs.
  Knows nothing about conversation logic.
- `src/services/conversationEngine.js` — orchestrates state: loads/creates
  the conversation, saves messages (immutable), calls Groq, and owns every
  deterministic state transition (handoff, disclosure). The model
  generates reply text only — it never decides what gets written to
  Firestore.
- `src/routes/telegram.js` — the webhook Telegram calls. Protected by a
  secret path segment (Telegram doesn't sign requests the way NOWPayments
  does), acknowledges immediately, processes after responding.

**To register the webhook with Telegram** (one-time, after deploying and
setting `TELEGRAM_WEBHOOK_SECRET`):
```
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://your-service.up.railway.app/api/telegram/webhook/<SECRET>"
```

**Not yet built**: the `userProfiles` summary generation (on-demand AI
summarization for the admin viewer), and the spam/scam detection and
subscription-lifecycle demo modules (Phase 4B/4C per the agreed order —
core conversation first, confirmed working, before secondary demos).

## What's deliberately NOT here yet

- Portfolio project CRUD (still direct Firestore writes from the admin
  panel, per the security rules — no backend needed for that).
- Conversation/profile summary generation for the admin viewer (next
  slice, once the core bot is confirmed working end-to-end).
- Spam/scam detection and subscription-lifecycle demo modules (Phase
  4B/4C — deliberately after the core conversational assistant, per the
  agreed build order).
