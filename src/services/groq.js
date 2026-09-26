import fetch from 'node-fetch';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;

// Production-designated model, configured centrally — not scattered
// through code. Change this one value to change the bot's model.
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calls Groq with bounded retries on 429/5xx, honoring Retry-After when
 * present. Returns { text, usage } on success, or throws after retries
 * are exhausted — the caller (conversation engine) is responsible for
 * the user-facing fallback message, not this function.
 */
export async function getChatCompletion(messages) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is not set.');
  }

  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const startedAt = Date.now();

    try {
      const response = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: MODEL,
          messages
        })
      });

      const latencyMs = Date.now() - startedAt;

      if (response.status === 429 || response.status >= 500) {
        const retryAfterHeader = response.headers.get('retry-after');
        const retryAfterMs = retryAfterHeader
          ? parseFloat(retryAfterHeader) * 1000
          : BASE_BACKOFF_MS * Math.pow(2, attempt);

        lastError = new Error(`Groq returned ${response.status}`);

        logRequest({ model: MODEL, latencyMs, success: false, retryCount: attempt, errorCategory: `http_${response.status}` });

        if (attempt < MAX_RETRIES) {
          await sleep(retryAfterMs);
          continue;
        }
        throw lastError;
      }

      if (!response.ok) {
        // Non-retryable error (e.g. 400 bad request, 401 auth) — fail fast.
        const body = await response.text();
        logRequest({ model: MODEL, latencyMs, success: false, retryCount: attempt, errorCategory: `http_${response.status}` });
        throw new Error(`Groq request failed (${response.status}): ${body}`);
      }

      const data = await response.json();
      const text = data.choices?.[0]?.message?.content || '';

      logRequest({
        model: MODEL,
        latencyMs,
        success: true,
        retryCount: attempt,
        inputTokens: data.usage?.prompt_tokens,
        outputTokens: data.usage?.completion_tokens,
        cachedTokens: data.usage?.prompt_tokens_details?.cached_tokens
      });

      return { text, usage: data.usage };
    } catch (err) {
      lastError = err;
      if (attempt >= MAX_RETRIES) break;
      await sleep(BASE_BACKOFF_MS * Math.pow(2, attempt));
    }
  }

  throw lastError;
}

/**
 * Per-request observability — never logs the API key, never logs full
 * prompt/conversation content (that's already in Firestore under the
 * retention policy; duplicating it into operational logs is unnecessary
 * exposure).
 */
function logRequest(meta) {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    action: 'groq.request',
    ...meta
  }));
}

export const FALLBACK_MESSAGE =
  "Give me a second — I'm having trouble getting a response right now. You can message Michael directly and he'll get back to you.";
