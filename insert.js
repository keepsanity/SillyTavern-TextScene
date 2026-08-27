/** Inserts a finished text scene into the main chat as a single narrator message. */

import {
    chat,
    addOneMessage,
    saveChatConditional,
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

/** Renders the log as a markdown blockquote. */
function renderLog(session, messages) {
    const charName = session.charName || 'Character';
    const userName = getUserName();
    return messages
        .map(m => {
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
    const count = targets.length;
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
    const targets = messages ?? session.messages;
    const text = buildInsertText(session, mode, summary, targets);
    if (!text.trim()) return false;

    const message = {
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
                mode,
                count: targets.length,
            },
        },
    };

    try {
        chat_metadata.tainted = true;
        chat.push(message);
        addOneMessage(message);
        await saveChatConditional();
        return true;
    } catch (error) {
        console.error(DEBUG_PREFIX, 'Insert failed:', error);
        if (typeof toastr !== 'undefined') {
            toastr.error('메인 채팅에 넣지 못했습니다. 콘솔을 확인해 주세요.', '문자 씬');
        }
        return false;
    }
}
