/** Defaults and accessors for extension_settings. Settings only — never the text log. */

import { extension_settings } from '../../../extensions.js';
import { THEMES, DEFAULT_THEME } from './themes.js';
import {
    EXTENSION_NAME,
    MESSENGER_SYSTEM,
    SUMMARY_PROMPT,
    INSERT_MODE,
    LANG,
    DEFAULT_BRIDGE_TURNS,
    DEFAULT_MAX_TOKENS,
    SUMMARY_MAX_TOKENS,
    TIME_ESTIMATE_MAX_TOKENS,
} from './constants.js';

const DEFAULTS = {
    theme: DEFAULT_THEME,
    /** Connection profile id. Falls back to the current API when empty. */
    profileId: '',
    maxTokens: DEFAULT_MAX_TOKENS,
    summaryMaxTokens: SUMMARY_MAX_TOKENS,
    timeMaxTokens: TIME_ESTIMATE_MAX_TOKENS,
    /** Recent main-chat turns loaded via the bridge. 0 disables the bridge. */
    bridgeTurns: DEFAULT_BRIDGE_TURNS,
    typingEffect: true,
    defaultInsertMode: INSERT_MODE.SUMMARY,
    insertLanguage: LANG.AUTO,
    /** Use the infoblock scene time as the bubble timestamp; when off no time is shown. */
    infoblockTime: true,
    timeRegex: '',
    dateRegex: '',
    /** Ask the model how much time passed since the previous scene. */
    autoEstimateGap: true,
    /** Judge on open whether the character texted first during the RP. */
    catchup: true,
    insertTime: true,
    messengerPrompt: '',
    summaryPrompt: '',
};

export function ensureSettings() {
    if (!extension_settings[EXTENSION_NAME]) {
        extension_settings[EXTENSION_NAME] = {};
    }
    const s = extension_settings[EXTENSION_NAME];
    for (const [key, value] of Object.entries(DEFAULTS)) {
        if (s[key] === undefined) s[key] = value;
    }
    // One-time migration off an older, too-low default; leaves deliberate values alone.
    if (!s.tokenFixApplied) {
        s.tokenFixApplied = true;
        if (Number(s.maxTokens) <= 300) s.maxTokens = DEFAULT_MAX_TOKENS;
    }
    // Thinking tokens share the cap, so anything tight starves the body.
    if (!s.thinkingFixApplied) {
        s.thinkingFixApplied = true;
        if (Number(s.maxTokens) <= 1000) s.maxTokens = DEFAULT_MAX_TOKENS;
    }
    // Drop stored copies that only ever held a past default, so the current one applies.
    if (!s.promptUnfreezeApplied) {
        s.promptUnfreezeApplied = true;
        if (String(s.messengerPrompt || '').startsWith('<messenger_mode')
            && !String(s.messengerPrompt).includes('<reply_timing')) {
            s.messengerPrompt = '';
        }
    }
    if (!s.capFixApplied) {
        s.capFixApplied = true;
        if (Number(s.maxTokens) <= 3000) s.maxTokens = DEFAULT_MAX_TOKENS;
    }
    return s;
}

export function getSettings() {
    return ensureSettings();
}

/** Reads a numeric setting, clamped, falling back to the default. */
function num(key, min, max) {
    const s = ensureSettings();
    const v = Number(s[key]);
    if (!Number.isFinite(v)) return DEFAULTS[key];
    return Math.min(max, Math.max(min, Math.round(v)));
}

export function getMaxTokens() {
    return num('maxTokens', 200, 20000);
}

export function getSummaryMaxTokens() { return num('summaryMaxTokens', 500, 20000); }
export function getTimeMaxTokens() { return num('timeMaxTokens', 200, 20000); }

export function getBridgeTurns() {
    return num('bridgeTurns', 0, 20);
}

export function getProfileId() {
    return ensureSettings().profileId || '';
}

export function isTypingEffectEnabled() {
    return !!ensureSettings().typingEffect;
}

export function getMessengerPrompt() {
    const s = ensureSettings();
    return String(s.messengerPrompt || '').trim() || MESSENGER_SYSTEM;
}

export function getSummaryPrompt() {
    const s = ensureSettings();
    return String(s.summaryPrompt || '').trim() || SUMMARY_PROMPT;
}

export function getDefaultInsertMode() {
    const s = ensureSettings();
    return Object.values(INSERT_MODE).includes(s.defaultInsertMode)
        ? s.defaultInsertMode
        : INSERT_MODE.SUMMARY;
}

export function isInfoblockTimeEnabled() {
    return !!ensureSettings().infoblockTime;
}

export function isAutoEstimateEnabled() {
    return !!ensureSettings().autoEstimateGap;
}

export function isCatchupEnabled() {
    return !!ensureSettings().catchup;
}

export function isInsertTimeEnabled() {
    return !!ensureSettings().insertTime;
}

export function getTimeRegexSource() {
    const s = ensureSettings();
    return String(s.timeRegex || '').trim();
}

export function getDateRegexSource() {
    const s = ensureSettings();
    return String(s.dateRegex || '').trim();
}

export function getThemeKey() {
    const s = ensureSettings();
    return THEMES[s.theme] ? s.theme : DEFAULT_THEME;
}

export function getInsertLanguage() {
    const s = ensureSettings();
    return Object.values(LANG).includes(s.insertLanguage) ? s.insertLanguage : LANG.AUTO;
}

export { DEFAULTS };
