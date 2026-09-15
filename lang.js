/** Language detection for insert text. The overlay UI language follows SillyTavern separately. */

import { getContext } from '../../../extensions.js';
import { LANG } from './constants.js';
import { getInsertLanguage } from './config.js';

/** Characters to sample from recent messages. */
const SAMPLE_CHARS = 600;

/** Detects the language of recent main-chat content. Defaults to English. */
export function detectChatLanguage() {
    let sample = '';
    try {
        const chat = getContext().chat ?? [];
        for (let i = chat.length - 1; i >= 0 && sample.length < SAMPLE_CHARS; i--) {
            const message = chat[i];
            if (!message || message.is_system) continue;
            sample += String(message.mes ?? '') + ' ';
        }
    } catch {
        return LANG.EN;
    }

    const hangul = (sample.match(/[가-힣]/g) ?? []).length;
    const latin = (sample.match(/[A-Za-z]/g) ?? []).length;
    return hangul > latin ? LANG.KO : LANG.EN;
}

export function getEffectiveLanguage() {
    const configured = getInsertLanguage();
    return configured === LANG.AUTO ? detectChatLanguage() : configured;
}

export function getLanguageName(lang) {
    return lang === LANG.KO ? 'Korean' : 'English';
}
