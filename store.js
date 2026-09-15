/** Session store. Sessions live in `chat_metadata[META_KEY].sessions` of the current chat. */

import { chat, chat_metadata, saveChatDebounced } from '../../../../script.js';
import { uuidv4 } from '../../../utils.js';
import { META_KEY, WHO } from './constants.js';
import { readSceneDate, nextStamp, restampMessages } from './infoblock.js';
import { getCommitBatch, getCommits, invalidateFrom } from './commits.js';

export function getSessions() {
    if (!chat_metadata[META_KEY] || typeof chat_metadata[META_KEY] !== 'object') {
        chat_metadata[META_KEY] = { sessions: [] };
    }
    if (!Array.isArray(chat_metadata[META_KEY].sessions)) {
        chat_metadata[META_KEY].sessions = [];
    }
    return chat_metadata[META_KEY].sessions;
}

export function saveSessions() {
    saveChatDebounced();
}

export function getSession(id) {
    if (!id) return null;
    return getSessions().find(s => s.id === id) ?? null;
}

/** Returns the existing unclosed session if there is one, otherwise creates a new one. */
export function startSession(charName) {
    const open = getSessions().find(s => !s.closed);
    if (open) { getCommits(open); return open; }

    const sceneDate = readSceneDate();
    const session = {
        // crypto.randomUUID is unavailable in an insecure context; use the ST helper.
        id: uuidv4(),
        charName: String(charName || ''),
        startedAt: Date.now(),
        /** Minutes since the previous scene; null = not yet estimated */
        timeShift: null,
        /** Parsed in-story date {year, month, day, hasWeekday} that timestamps accumulate from */
        anchorDate: sceneDate?.parsed ?? null,
        /** Raw infoblock text, used when the format couldn't be parsed */
        anchorDateRaw: sceneDate?.raw ?? '',
        endedAt: null,
        closed: false,
        insertedAt: null,
        summary: '',
        messages: [],
        commits: [],
        commitMigrationDone: true,
        draft: '',
        contextNote: '',
        bundleMode: false,
    };
    getSessions().push(session);
    saveSessions();
    return session;
}

/**
 * Appends one message. The in-story stamp is baked in at send time, never recomputed on render.
 * `delayMinutes` overrides the real elapsed time.
 */
export function appendMessage(sessionId, who, text, { delayMinutes = null, kind = null, burstId = null } = {}) {
    const session = getSession(sessionId);
    if (!session) return null;
    const now = Date.now();
    const stamp = nextStamp(session, now, { delayMinutes });
    const message = {
        id: uuidv4(),
        who: who === WHO.CHAR ? WHO.CHAR : WHO.USER,
        text: String(text ?? ''),
        at: now,
        /** In-story minutes since midnight */
        sceneMin: stamp.sceneMin,
        clock: stamp.clock,
        date: stamp.date,
        anchorDate: session.anchorDate ? { ...session.anchorDate } : null,
        anchorDateRaw: session.anchorDateRaw,
        /** Whether the character has seen it; only meaningful for user messages */
        read: who === WHO.CHAR,
        /** Already carried over into the main chat */
        inserted: false,
        kind,
        burstId,
    };
    session.messages.push(message);
    saveSessions();
    return message;
}

export function updateMessage(sessionId, messageId, text) {
    const session = getSession(sessionId);
    const message = session?.messages.find(m => m.id === messageId);
    if (!message) return false;
    getCommits(session);
    message.text = String(text ?? '');
    saveSessions();
    return true;
}

export function deleteMessage(sessionId, messageId) {
    const session = getSession(sessionId);
    if (!session) return false;
    const idx = session.messages.findIndex(m => m.id === messageId);
    if (idx === -1) return false;
    getCommits(session);
    session.messages.splice(idx, 1);
    saveSessions();
    return true;
}

/** Deletes the given message and everything after it. */
export function truncateFrom(sessionId, messageId) {
    const session = getSession(sessionId);
    if (!session) return false;
    const idx = session.messages.findIndex(m => m.id === messageId);
    if (idx === -1) return false;
    getCommits(session);
    session.messages.splice(idx);
    saveSessions();
    return true;
}

/** Start index of the character's trailing run of messages, or -1. */
export function lastCharBurstStart(session) {
    if (!session?.messages?.length) return -1;
    const messages = session.messages;
    let i = messages.length - 1;
    if (messages[i].who !== WHO.CHAR || messages[i].kind) return -1;
    const burstId = messages[i].burstId;
    while (i > 0 && messages[i - 1].who === WHO.CHAR && !messages[i - 1].kind
        && (!burstId || messages[i - 1].burstId === burstId)) i--;
    return i;
}

/** Sets the gap (minutes) from the previous scene, restamping existing messages by the delta. */
export function setTimeShift(sessionId, minutes) {
    const session = getSession(sessionId);
    if (!session) return false;
    const next = Math.max(0, Math.round(Number(minutes) || 0));
    const delta = next - (Number(session.timeShift) || 0);
    session.timeShift = next;
    restampMessages(session, delta);
    saveSessions();
    return true;
}

export function getTimeShift(session) {
    return Math.max(0, Math.round(Number(session?.timeShift) || 0));
}

export function getPendingMessages(session) {
    return session ? getCommitBatch(session).messages : [];
}

export function getInsertedCount(session) {
    return (session?.messages ?? []).filter(m => m.inserted).length;
}

export function markInserted(sessionId, messageIds) {
    const session = getSession(sessionId);
    if (!session) return false;
    const ids = new Set(messageIds);
    for (const message of session.messages) {
        if (ids.has(message.id)) message.inserted = true;
    }
    session.lastInsertedAt = Date.now();
    session.chatLenAtInsert = Array.isArray(chat) ? chat.length : 0;
    session.storyRevisionAtInsert = storyRevision();
    session.lastCatchupRevision = session.storyRevisionAtInsert;
    saveSessions();
    return true;
}

export function markRead(sessionId) {
    const session = getSession(sessionId);
    if (!session) return false;
    let changed = false;
    for (const message of session.messages) {
        if (message.who === WHO.USER && !message.read) {
            message.read = true;
            changed = true;
        }
    }
    if (changed) saveSessions();
    return changed;
}

/** Whether the main chat advanced since the last carry-over. */
export function hasStoryMovedOn(session) {
    // 0 is a valid length; only a missing record means nothing was ever carried over.
    if (session?.chatLenAtInsert == null) return false;
    const now = Array.isArray(chat) ? chat.length : 0;
    const revision = session.lastCatchupRevision || session.storyRevisionAtInsert;
    return revision ? storyRevision() !== revision : now > session.chatLenAtInsert;
}

/** Includes content so edits and swipes count; inserted phone blocks are not new RP events. */
export function storyRevision() {
    let hash = 2166136261;
    let count = 0;
    for (const message of chat) {
        if (message.extra?.textscene_session) continue;
        count++;
        const value = JSON.stringify([message.is_user, message.name, message.mes]);
        for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
    }
    return `${count}:${hash >>> 0}`;
}

export function markCatchupChecked(session, revision) {
    if (getSession(session.id) !== session) return;
    session.lastCatchupRevision = revision;
    saveSessions();
}

export function getUnreadCount(session) {
    return (session?.messages ?? []).filter(m => m.who === WHO.USER && !m.read).length;
}

/** Marks this message and everything after it as not carried over. */
export function unmarkInsertedFrom(sessionId, messageId) {
    const session = getSession(sessionId);
    if (!session) return false;
    const idx = session.messages.findIndex(m => m.id === messageId);
    if (idx === -1) return false;
    invalidateFrom(session, messageId);
    let changed = false;
    for (let i = idx; i < session.messages.length; i++) {
        if (session.messages[i].inserted) {
            session.messages[i].inserted = false;
            changed = true;
        }
    }
    if (changed) saveSessions();
    return changed;
}

export function setSummary(sessionId, summary) {
    const session = getSession(sessionId);
    if (!session) return false;
    session.summary = String(summary ?? '');
    saveSessions();
    return true;
}

export function closeSession(sessionId, { inserted = false } = {}) {
    const session = getSession(sessionId);
    if (!session) return false;
    session.closed = true;
    session.endedAt = Date.now();
    if (inserted) session.insertedAt = Date.now();
    saveSessions();
    return true;
}

export function discardSession(sessionId) {
    const sessions = getSessions();
    const idx = sessions.findIndex(s => s.id === sessionId);
    if (idx === -1) return false;
    sessions.splice(idx, 1);
    saveSessions();
    return true;
}

export function getOpenSession() {
    return getSessions().find(s => !s.closed) ?? null;
}
