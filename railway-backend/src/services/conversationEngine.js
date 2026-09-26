import { db } from '../firebaseAdmin.js';
import { buildPromptMessages, getFirstMessageDisclosure } from '../../bot-config/promptBuilder.js';
import { getChatCompletion, FALLBACK_MESSAGE } from './groq.js';
import { logAction } from '../utils/logger.js';

const RECENT_MESSAGES_LIMIT = 12; // bounded context — not full history

/**
 * Handles one incoming text message end-to-end: loads/creates
 * conversation state, builds the bounded prompt, calls Groq, saves
 * messages, and returns the text to send back.
 *
 * This function OWNS deterministic state (conversation status, message
 * persistence). The LLM only generates the reply text — it never decides
 * what gets written to Firestore.
 */
export async function handleIncomingMessage({ telegramUserId, telegramUsername, text }) {
  const conversationRef = db.collection('conversations').doc(telegramUserId);
  const conversationSnap = await conversationRef.get();

  const isNewConversation = !conversationSnap.exists;
  const now = new Date();

  if (isNewConversation) {
    await conversationRef.set({
      telegramUserId,
      telegramUsername,
      status: 'active',
      startedAt: now,
      lastMessageAt: now,
      currentIntent: null,
      handoffRequested: false,
      lastProcessedMessageId: null,
      disclosureShown: false
    });
  }

  // Log the incoming message — immutable historical record.
  const userMessageRef = await conversationRef.collection('messages').add({
    role: 'user',
    text,
    timestamp: now,
    messageType: 'text'
  });

  // First-ever message in a conversation gets the disclosure, sent as its
  // own message BEFORE the AI-generated reply — never blended into it.
  const replies = [];
  if (isNewConversation) {
    replies.push(getFirstMessageDisclosure());
    await conversationRef.update({ disclosureShown: true });
  }

  const profileSummary = await getProfileSummary(telegramUserId);
  const recentMessages = await getRecentMessages(conversationRef);

  let assistantText;
  try {
    const { text: generated } = await getChatCompletion(
      buildPromptMessages({ profileSummary, recentMessages, currentMessage: text })
    );
    assistantText = generated;
  } catch (err) {
    logAction('conversation.llm_failed', { telegramUserId, error: err.message });
    assistantText = FALLBACK_MESSAGE;
  }

  replies.push(assistantText);

  await conversationRef.collection('messages').add({
    role: 'assistant',
    text: assistantText,
    timestamp: new Date(),
    messageType: 'text'
  });

  await conversationRef.update({
    lastMessageAt: new Date(),
    lastProcessedMessageId: userMessageRef.id
  });

  return replies;
}

/**
 * A structured button press sets deterministic state directly — the
 * model never "decides" this, application code does, per the frozen
 * contract's rule that the LLM doesn't own state transitions.
 */
export async function handleCallbackAction({ telegramUserId, action }) {
  const conversationRef = db.collection('conversations').doc(telegramUserId);

  if (action === 'talk_to_michael') {
    await conversationRef.update({
      handoffRequested: true,
      status: 'handed_off',
      lastMessageAt: new Date()
    });
    logAction('conversation.handoff_requested', { telegramUserId });
    return "I've flagged this for Michael — he'll follow up with you directly.";
  }

  // Other semantic actions (ask_about_services, etc.) get added here as
  // they're defined — each one is an explicit, named case, never inferred
  // from button label text.
  logAction('conversation.unknown_action', { telegramUserId, action });
  return null;
}

async function getRecentMessages(conversationRef) {
  const snapshot = await conversationRef
    .collection('messages')
    .orderBy('timestamp', 'desc')
    .limit(RECENT_MESSAGES_LIMIT)
    .get();

  return snapshot.docs
    .map((d) => d.data())
    .reverse(); // chronological order for the prompt
}

async function getProfileSummary(telegramUserId) {
  const profileSnap = await db.collection('userProfiles').doc(telegramUserId).get();
  if (!profileSnap.exists) return null;
  return profileSnap.data().summary || null;
}
