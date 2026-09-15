/**
 * Prompt assembly.
 * Every builder must return fresh arrays and objects: createRawPrompt mutates content in place.
 */

import { substituteParams } from '../../../../script.js';
import { getContext } from '../../../extensions.js';
import { power_user } from '../../../power-user.js';
import {
    WHO,
    PROACTIVE_INSTRUCTION,
    CATCHUP_INSTRUCTION,
    BRIDGE_TEMPLATE,
    BRIDGE_SCENE_PLACEHOLDER,
    BRIDGE_CHAR_LIMIT,
    LOG_WINDOW,
    SUMMARY_LOG_PLACEHOLDER,
    TIME_ESTIMATE_PROMPT,
    META_KEY,
} from './constants.js';
import { getMessengerPrompt, getSummaryPrompt, getBridgeTurns } from './config.js';
import { getEffectiveLanguage, getLanguageName } from './lang.js';
import { truncate, excerpt } from './utils.js';

/** The current character card. null for groups or when none is selected. */
function getCharacter() {
    const ctx = getContext();
    const id = ctx.characterId;
    if (id === undefined || id === null || id === '') return null;
    return ctx.characters?.[id] ?? null;
}

export function getCharName() {
    const ctx = getContext();
    return getCharacter()?.name || ctx.name2 || 'Character';
}

export function getUserName() {
    return getContext().name1 || 'You';
}

function buildCharacterBlock() {
    const char = getCharacter();
    if (!char) return '';
    const parts = [];
    if (char.description?.trim()) parts.push(char.description.trim());
    if (char.personality?.trim()) parts.push(`Personality: ${char.personality.trim()}`);
    if (char.scenario?.trim()) parts.push(`Scenario: ${char.scenario.trim()}`);
    const examples = char.mes_example || char.data?.mes_example;
    if (examples?.trim()) parts.push(`Voice examples (style only; do not copy actions or past events):\n${excerpt(examples, 1600)}`);
    if (!parts.length) return '';
    return `<character name="${getCharName()}">\n${parts.join('\n\n')}\n</character>`;
}

function buildPersonaBlock() {
    const description = String(power_user?.persona_description ?? '').trim();
    if (!description) return '';
    return `<persona name="${getUserName()}">\n${description}\n</persona>`;
}

/** The bridge block: recent main-chat turns, wrapped in the bridge template. */
export function buildBridgeBlock() {
    const text = buildBridgeText(getBridgeTurns());
    return text ? BRIDGE_TEMPLATE.replace(BRIDGE_SCENE_PLACEHOLDER, text) : '';
}

/** Recent turns as verbatim `name: line` entries, capped per message. */
export function buildBridgeText(turns) {
    if (turns <= 0) return '';

    const ctx = getContext();
    const chat = Array.isArray(ctx.chat) ? ctx.chat : [];
    const picked = [];
    for (let i = chat.length - 1; i >= 0 && picked.length < turns; i--) {
        const message = chat[i];
        if (!message || message.is_system) continue;
        const text = String(message.mes ?? '').trim();
        if (!text) continue;
        const speaker = message.is_user ? getUserName() : (message.name || getCharName());
        picked.push(`${speaker}: ${excerpt(text, BRIDGE_CHAR_LIMIT)}`);
    }
    if (!picked.length) return '';

    picked.reverse();
    return picked.join('\n\n');
}

/**
 * Message array for reply generation.
 * @param {boolean} [opts.proactive] The character is initiating unprompted
 * @param {boolean} [opts.catchup] Ask whether the character texted first in the meantime
 * @returns {Array<{role: string, content: string}>}
 */
export function buildChatMessages(session, { proactive = false, catchup = false, intent = '', messages: sourceMessages = null } = {}) {
    const systemParts = [getMessengerPrompt()];
    systemParts.push(`<knowledge_boundaries>
Recent RP is author context, not information automatically known to {{char}}. {{char}} cannot see {{user}}'s private thoughts, hidden actions or location unless told or directly known. You are apart and communicating by phone. Preserve established promises and relationship state; distinguish a proposal from an agreement. Never invent {{user}}'s words, choices or consent. Parentheses and emoji typed as actual texts are allowed. Do not include actions or narration.
</knowledge_boundaries>`);

    const character = buildCharacterBlock();
    if (character) systemParts.push(character);

    const persona = buildPersonaBlock();
    if (persona) systemParts.push(persona);

    const bridge = buildBridgeBlock();
    if (bridge) systemParts.push(bridge);

    if (proactive && !session?.messages?.length) systemParts.push(PROACTIVE_INSTRUCTION);
    else if (proactive) systemParts.push('Send a follow-up text only as {{char}}. Do not pretend the existing exchange never happened.');
    if (catchup) systemParts.push(CATCHUP_INSTRUCTION);
    if (intent) systemParts.push(`<scene_direction>
The user requests this direction: ${String(intent).slice(0, 800)}
Move toward a natural stopping point in this reply rather than prolonging the exchange. Still output only {{char}}'s 1-3 texts and the reply marker. Do NOT write {{user}}'s replies, assume agreement, or invent completed plans. If a decision from {{user}} is needed, ask and stop. This direction overrides the earlier instruction to keep the exchange going, but not character knowledge or user agency.
</scene_direction>`);

    const log = sourceMessages ?? session?.messages ?? [];
    const continuity = buildContinuity(session, log);
    if (continuity) systemParts.push(continuity);

    // Resolve macros here: the connection-profile path never applies substituteParams.
    const messages = [{ role: 'system', content: substituteParams(systemParts.join('\n\n')) }];

    const window = log.slice(-LOG_WINDOW);
    for (const entry of window) {
        messages.push({
            role: entry.kind ? 'system' : entry.who === WHO.CHAR ? 'assistant' : 'user',
            content: entry.kind ? formatLog(session, [entry]) : entry.text,
        });
    }

    // The last turn must be 'user'. Leaving an assistant turn last makes the core rewrite its
    // role while keeping the character's own words, so the model sees nothing to answer and
    // returns an empty completion.
    let closing = null;
    if (intent) {
        closing = '[Respond to the requested scene direction now, as {{char}} only.]';
    } else if (!window.length) {
        closing = '[Send the first text message now.]';
    } else if (catchup) {
        closing = '[Did {{char}} text first in the meantime? Answer with the marker.]';
    } else if (window[window.length - 1]?.who === WHO.CHAR || window[window.length - 1]?.kind) {
        closing = '[Send the next text message now.]';
    }
    if (closing) messages.push({ role: 'user', content: substituteParams(closing) });

    return messages;
}

/** Renders the log as plain `name: text` lines. `messages` restricts it to a subset. */
export function formatLog(session, messages = null) {
    const charName = session?.charName || getCharName();
    const userName = getUserName();
    return (messages ?? session?.messages ?? [])
        .map(m => m.kind
            ? `[Phone event${m.clock ? ' at ' + m.clock : ''}: ${m.kind === 'silent' ? 'read, no reply' : 'not read'}]`
            : `${m.clock ? '[' + m.clock + '] ' : ''}${m.who === WHO.CHAR ? charName : userName}: ${m.text}`)
        .join('\n');
}

/** Message array for summary generation. The output language follows the RP, not the log. */
export function buildSummaryMessages(session, messages = null) {
    const log = formatLog(session, messages);
    const template = getSummaryPrompt();
    const filled = template.includes(SUMMARY_LOG_PLACEHOLDER)
        ? template.replace(SUMMARY_LOG_PLACEHOLDER, log)
        // A custom prompt may have dropped the placeholder; the log still has to be included.
        : `${template}\n\n<messages>\n${log}\n</messages>`;
    const language = getLanguageName(getEffectiveLanguage());
    const targets = messages ?? session.messages;
    const ids = new Set(targets.map(m => m.id));
    const first = session.messages.findIndex(m => ids.has(m.id));
    const preceding = first > 0 ? session.messages.slice(Math.max(0, first - 12), first) : [];
    const reference = `${session.contextNote || ''}\n${formatLog(session, preceding)}`.trim();
    return [
        { role: 'system', content: `Write your entire output in ${language}, regardless of the language used in the messages. Only summarize the target messages. Keep proposed plans distinct from agreements. Do not inflate affectionate small talk into a new relationship milestone. Phone silence is only important if it changes what happens next.${reference ? '\n<reference_only>Use this only to resolve references such as yes or tomorrow; do not summarize it as new events.\n' + reference + '\n</reference_only>' : ''}` },
        { role: 'user', content: substituteParams(filled) },
    ];
}

/** Editable facts plus recent archived context; no extra model call for every short text. */
function buildContinuity(session, log) {
    const parts = [];
    if (session?.contextNote?.trim()) parts.push(`User-maintained scene facts and outstanding plans:\n${session.contextNote.trim()}`);
    const archives = (getContext().chatMetadata?.[META_KEY]?.sessions ?? []).filter(s => s !== session && s.closed).slice(-3);
    for (const previous of archives) {
        const summaries = (previous.commits ?? []).map(c => c.summary).filter(Boolean).join('\n');
        parts.push(`Previous text scene (past, not happening now):\n${summaries || formatLog(previous, previous.messages.slice(-8))}`);
    }
    const old = log.slice(0, Math.max(0, log.length - LOG_WINDOW));
    if (old.length) {
        const summaries = (session?.commits ?? []).filter(c => c.saved && !c.forceDirty && c.summary).map(c => c.summary);
        parts.push(`Earlier exchange, reference only:\n${summaries.slice(-6).join('\n')}\n${formatLog(session, old.slice(-12))}`);
    }
    const last = log.at(-1);
    if (last) parts.push(`Current phone time: ${last.date || ''} ${last.clock || 'unknown'}. Last user message read: ${[...log].reverse().find(m => m.who === WHO.USER)?.read ?? false}.`);
    return parts.length ? `<continuity>\n${parts.map(p => truncate(p, 4000)).join('\n\n')}\n</continuity>` : '';
}

/** Message array asking how much time passed between the last scene and the text scene. */
export function buildTimeEstimateMessages() {
    const bridge = buildBridgeText(Math.max(2, getBridgeTurns()));
    if (!bridge) return null;
    const filled = TIME_ESTIMATE_PROMPT.replace(BRIDGE_SCENE_PLACEHOLDER, bridge);
    return [{ role: 'user', content: substituteParams(filled) }];
}

/** On-demand refresh, kept editable and separate from the actual message transcript. */
export function buildSceneContextMessages(session) {
    return [
        { role: 'system', content: 'Extract a short continuity note in Korean, at most 6 short bullet points. This is data extraction, not RP. Record only established current circumstances, character-known facts, agreed plans, proposed but unconfirmed plans, and unresolved questions. Distinguish what the character knows from private author/user information. Do not turn hidden thoughts into shared facts. Label uncertain or inferred information explicitly. Do not invent details or intensify the relationship. Prefer newer explicit facts over outdated notes.' },
        { role: 'user', content: `Character: ${getCharName()}\n<previous_note>\n${session.contextNote || ''}\n</previous_note>\n<recent_rp>\n${buildBridgeText(Math.max(3, getBridgeTurns()))}\n</recent_rp>\n<recent_texts>\n${formatLog(session, session.messages.slice(-40))}\n</recent_texts>` },
    ];
}
