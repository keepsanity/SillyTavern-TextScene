/** UI language follows SillyTavern, independently of the RP insertion language. */
import { getCurrentLocale } from '../../../i18n.js';
import english from './locales/en.js';

/** Korean locales use the original text; all other locales fall back to English. */
export function t(source, values = {}) {
    const template = /^ko(?:-|$)/i.test(getCurrentLocale()) ? source : (english[source] ?? source);
    return template.replace(/\{(\w+)\}/g, (match, key) => Object.hasOwn(values, key) ? String(values[key]) : match);
}
