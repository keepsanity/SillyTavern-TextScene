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
} from './constants.js';
import { getMessengerPrompt, getSummaryPrompt, getBridgeTurns } from './config.js';
import { getEffectiveLanguage, getLanguageName } from './lang.js';
import { truncate } from './utils.js';

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
        picked.push(`${speaker}: ${truncate(text, BRIDGE_CHAR_LIMIT)}`);
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
export function buildChatMessages(session, { proactive = false, catchup = false } = {}) {
    const systemParts = [getMessengerPrompt()];

    const character = buildCharacterBlock();
    if (character) systemParts.push(character);

    const persona = buildPersonaBlock();
    if (persona) systemParts.push(persona);

    const bridge = buildBridgeBlock();
    if (bridge) systemParts.push(bridge);

    if (proactive) systemParts.push(PROACTIVE_INSTRUCTION);
    if (catchup) systemParts.push(CATCHUP_INSTRUCTION);

    // Resolve macros here: the connection-profile path never applies substituteParams.
    const messages = [{ role: 'system', content: substituteParams(systemParts.join('\n\n')) }];

    const log = session?.messages ?? [];
    const window = log.slice(-LOG_WINDOW);
    for (const entry of window) {
        messages.push({
            role: entry.who === WHO.CHAR ? 'assistant' : 'user',
            content: entry.text,
        });
    }

    // The last turn must be 'user'. Leaving an assistant turn last makes the core rewrite its
    // role while keeping the character's own words, so the model sees nothing to answer and
    // returns an empty completion.
    let closing = null;
    if (!window.length) {
        closing = '[Send the first text message now.]';
    } else if (catchup) {
        closing = '[Did {{char}} text first in the meantime? Answer with the marker.]';
    } else if (window[window.length - 1]?.who === WHO.CHAR) {
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
        .map(m => `${m.who === WHO.CHAR ? charName : userName}: ${m.text}`)
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
    return [
        { role: 'system', content: `Write your entire output in ${language}, regardless of the language used in the messages.` },
        { role: 'user', content: substituteParams(filled) },
    ];
}

/** Message array asking how much time passed between the last scene and the text scene. */
export function buildTimeEstimateMessages() {
    const bridge = buildBridgeText(Math.max(2, getBridgeTurns()));
    if (!bridge) return null;
    const filled = TIME_ESTIMATE_PROMPT.replace(BRIDGE_SCENE_PLACEHOLDER, bridge);
    return [{ role: 'user', content: substituteParams(filled) }];
}
