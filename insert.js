import { t } from './i18n.js';

/** Inserts a finished text scene into the main chat as a single narrator message. */

import {
    chat,
    addOneMessage,
    updateMessageBlock,
    eventSource,
    event_types,
    chat_metadata,
    system_avatar,
} from '../../../../script.js';
import { getMessageTimeStamp } from '../../../RossAscends-mods.js';
import { system_message_types } from '../../../system-messages.js';
import { INSERT_MODE, INSERT_MARKER, INSERT_LABELS, LANG, WHO, DEBUG_PREFIX } from './constants.js';
import { getUserName } from './prompt.js';
import { getEffectiveLanguage } from './lang.js';
import { isInsertTimeEnabled } from './config.js';
import { withParticle } from './utils.js';
import { uuidv4 } from '../../../utils.js';
import { getCommitBatch, getCommits, fingerprint, findCommitMessage } from './commits.js';
import { captureOwner, ensureCurrent } from './lifecycle.js';
import { markInserted, getSession } from './store.js';
import { S } from './state.js';
import { persistChat } from './persistence.js';

/** Renders the log as a markdown blockquote. */
function renderLog(session, messages) {
    const charName = session.charName || 'Character';
    const userName = getUserName();
    return messages
        .map(m => {
            if (m.kind) {
                const label = getEffectiveLanguage() === LANG.KO
                    ? (m.kind === 'silent' ? '읽음 · 답장 없음' : '아직 읽지 않음')
                    : (m.kind === 'silent' ? 'Read · no reply' : 'Not read');
                return `> *${m.clock ? m.clock + ' · ' : ''}${label}*`;
            }
            const who = m.who === WHO.CHAR ? charName : userName;
            // Every line needs '> ' or multi-line texts break out of the blockquote.
            const body = String(m.text).split('\n').join('\n> ');
            return `> **${who}**: ${body}`;
        })
        .join('\n>\n');
}

/** Builds the header and collapsed-log label in the RP language, not the UI language. */
function buildLabels(session, targets) {
    const count = targets.length;
    const lang = getEffectiveLanguage();
    const labels = INSERT_LABELS[lang] ?? INSERT_LABELS[LANG.EN];
    const rawName = session.charName || 'Character';
    // Only Korean needs a trailing particle on the name.
    const name = lang === LANG.KO ? withParticle(rawName, '와', '과') : rawName;

    const stamp = isInsertTimeEnabled() ? buildTimeRange(targets) : '';
    const template = stamp ? labels.headerWithTime : labels.header;

    return {
        header: template.replace('{name}', name).replace('{time}', stamp),
        logSummary: labels.logSummary.replace('{count}', String(count)),
    };
}

/** The in-story time span this batch covers. Both ends get a date if the date rolled over. */
function buildTimeRange(targets) {
    const withClock = targets.filter(m => m.clock);
    if (!withClock.length) {
        return targets.find(m => m.date)?.date || '';
    }

    const first = withClock[0];
    const last = withClock[withClock.length - 1];
    const startDate = first.date || '';
    const endDate = last.date || '';

    if (startDate && endDate && startDate !== endDate) {
        return `${startDate} ${first.clock} – ${endDate} ${last.clock}`;
    }
    const range = first.clock === last.clock ? first.clock : `${first.clock} – ${last.clock}`;
    return startDate ? `${startDate}, ${range}` : range;
}

/**
 * Builds the body of the message to insert.
 * @param {string} mode One of INSERT_MODE
 */
export function buildInsertText(session, mode, summary, messages = null) {
    const targets = messages ?? session.messages;
    const { header, logSummary } = buildLabels(session, targets);
    const log = renderLog(session, targets);
    const clean = String(summary ?? '').trim();

    if (mode === INSERT_MODE.FULL) {
        return `${header}\n\n${log}`;
    }

    if (mode === INSERT_MODE.BOTH) {
        // Collapsed for display only; the body still goes into the prompt as-is.
        return `${header}\n\n${clean}\n\n<details>\n<summary>${logSummary}</summary>\n\n${log}\n\n</details>`;
    }

    // SUMMARY — the original log stays in the session only.
    return `${header}\n\n${clean}`;
}

/** Inserts into the main chat. Returns true on success. */
export async function insertIntoChat(session, mode, summary, messages = null) {
    if (S.isCommitting || getSession(session.id) !== session) return false;
    const owner = captureOwner(session);
    const batch = getCommitBatch(session);
    const targets = messages ?? batch.messages;
    if (fingerprint(targets) !== fingerprint(batch.messages)) return false;
    if (!targets.length && !batch.replacement) return false;
    let commit = batch.commit;
    let message = commit ? findCommitMessage(commit) : null;
    if (message && commit.lastText !== message.mes) {
        toastr.warning(t("RP에서 직접 수정한 반영본이 있어 덮어쓰지 않았어요. 문자 반영본을 확인해 주세요."), t("문자 씬"));
        return false;
    }
    const text = targets.length ? buildInsertText(session, mode, summary, targets)
        : getEffectiveLanguage() === LANG.KO ? '📱 *이 문자 구간의 내용이 삭제되었습니다.*' : '📱 *The messages in this text scene were removed.*';
    S.isCommitting = true;
    const isUpdate = !!message;
    if (!commit) {
        commit = { id: uuidv4(), messageIds: [], revisions: [] };
        getCommits(session).push(commit);
    }
    if (message && message.mes !== text) {
        commit.revisions ??= [];
        commit.revisions.push({ at: Date.now(), text: message.mes, summary: commit.summary });
    }
    if (!message) message = {
        name: session.charName || 'Character',
        is_user: false,
        // Must stay false: ST strips is_system messages from the prompt.
        is_system: false,
        send_date: getMessageTimeStamp(),
        mes: text,
        force_avatar: system_avatar,
        extra: {
            type: system_message_types.NARRATOR,
            gen_id: Date.now(),
            api: 'manual',
            model: 'text scene',
            [INSERT_MARKER]: {
                sessionId: session.id,
                commitId: commit.id,
            },
        },
    };

    try {
        ensureCurrent(owner);
        message.mes = text;
        Object.assign(message.extra[INSERT_MARKER], { mode, count: targets.length });
        Object.assign(commit, { messageIds: targets.map(m => m.id), fingerprint: fingerprint(targets),
            lastText: text, mode, summary, saved: true, forceDirty: false });
        session.summary = summary;
        // Mark BEFORE serialization: the phone log and its RP message are saved together.
        markInserted(session.id, targets.map(m => m.id));
        chat_metadata.tainted = true;
        if (!isUpdate) { chat.push(message); addOneMessage(message); }
        else updateMessageBlock(chat.indexOf(message), message);
        session.chatLenAtInsert = chat.length;
        // Core saveChatConditional swallows failures. Use the same endpoint with a fixed snapshot
        // and retain the commit ID on failure so retry updates this block instead of duplicating it.
        await persistChat(owner);
        if (owner()) {
            const index = chat.indexOf(message);
            try {
                await eventSource.emit(isUpdate ? event_types.MESSAGE_UPDATED : event_types.MESSAGE_RECEIVED, index, 'textscene');
                if (owner()) await eventSource.emit(event_types.CHARACTER_MESSAGE_RENDERED, index, 'textscene');
            } catch (error) { console.warn(DEBUG_PREFIX, 'Saved, but an extension event handler failed:', error); }
        }
        return true;
    } catch (error) {
        commit.saved = false;
        console.error(DEBUG_PREFIX, 'Insert failed:', error);
        if (typeof toastr !== 'undefined') {
            toastr.error(String(error?.message || error), t("문자 씬"));
        }
        return false;
    } finally { S.isCommitting = false; }
}
