// Pure helpers. Nothing DOM- or state-dependent.

import {
    BUBBLE_SPLIT_REGEX,
    REPLY_MARKER_REGEX,
    REPLY_KIND,
    REPLY_DELAY_MAX,
    TYPING_DELAY_MIN,
    TYPING_DELAY_MAX,
    TYPING_MS_PER_CHAR,
} from './constants.js';

export function escapeHtml(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** @returns {{kind: string, delayMinutes: number|null, text: string}} */
export function extractReplyMarker(raw) {
    const text = String(raw ?? '');
    const match = text.match(REPLY_MARKER_REGEX);
    if (!match) return { kind: REPLY_KIND.REPLY, delayMinutes: null, text };

    const [, none, digits, state] = match;
    const stripped = text.replace(match[0], '');

    if (none) return { kind: REPLY_KIND.NONE, delayMinutes: null, text: stripped };

    const minutes = Number(digits);
    const valid = Number.isFinite(minutes) && minutes >= 0 && minutes <= REPLY_DELAY_MAX;

    let kind = REPLY_KIND.REPLY;
    if (state === 'silent') kind = REPLY_KIND.SILENT;
    else if (state === 'unread') kind = REPLY_KIND.UNREAD;

    // Body text overrides a no-reply marker.
    if (kind !== REPLY_KIND.REPLY && stripped.trim()) kind = REPLY_KIND.REPLY;

    return { kind, delayMinutes: valid ? minutes : null, text: stripped };
}

/** Splits a model response into bubbles on whole-line `---` separators. */
export function splitIntoBubbles(raw) {
    const text = String(raw ?? '').trim();
    if (!text) return [];

    const chunks = [];
    let current = [];
    let sawSeparator = false;
    for (const line of text.split('\n')) {
        if (BUBBLE_SPLIT_REGEX.test(line)) {
            sawSeparator = true;
            chunks.push(current.join('\n'));
            current = [];
        } else {
            current.push(line);
        }
    }
    chunks.push(current.join('\n'));

    // No separator used: fall back to blank lines as boundaries.
    if (!sawSeparator && /\n\s*\n/.test(text)) {
        return text.split(/\n\s*\n+/)
            .map(chunk => stripNarration(chunk).trim())
            .filter(Boolean);
    }

    return chunks
        .map(chunk => stripNarration(chunk).trim())
        .filter(Boolean);
}

/** Drops whole lines wrapped entirely in asterisks or parentheses. */
function stripNarration(chunk) {
    return String(chunk)
        .split('\n')
        .filter(line => {
            const t = line.trim();
            if (!t) return true;
            if (/^\*[^*]+\*$/.test(t)) return false;
            if (/^\([^)]+\)$/.test(t)) return false;
            return true;
        })
        .join('\n');
}

export function typingDelayFor(text) {
    const ms = String(text ?? '').length * TYPING_MS_PER_CHAR;
    return Math.min(TYPING_DELAY_MAX, Math.max(TYPING_DELAY_MIN, ms));
}

/** `14:32` format. */
export function formatClock(timestamp) {
    const d = new Date(timestamp);
    if (Number.isNaN(d.getTime())) return '';
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
}

/** Appends the Korean particle matching the final consonant of the last syllable. */
export function withParticle(word, ifNoFinal, ifFinal) {
    const name = String(word ?? '').trim();
    if (!name) return name;
    const code = name.charCodeAt(name.length - 1);
    // Outside the Hangul syllable block (U+AC00..U+D7A3) the final consonant is undecidable.
    if (code < 0xAC00 || code > 0xD7A3) return name + ifNoFinal;
    // Offset % 28 != 0 means the syllable has a final consonant.
    const hasFinal = (code - 0xAC00) % 28 !== 0;
    return name + (hasFinal ? ifFinal : ifNoFinal);
}

/**
 * innerHeight, not 100vh: the mobile address bar makes 100vh overflow the visible area.
 * @returns {() => void} Cleanup; call when the overlay is removed.
 */
export function bindOverlayHeight(overlay) {
    const sync = () => {
        if (!overlay) return;
        overlay.style.height = window.innerHeight + 'px';
    };
    sync();
    window.addEventListener('resize', sync);
    window.addEventListener('orientationchange', sync);
    return () => {
        window.removeEventListener('resize', sync);
        window.removeEventListener('orientationchange', sync);
    };
}

export function truncate(text, n) {
    const t = String(text ?? '');
    return t.length > n ? t.slice(0, n) + '…' : t;
}

/** navigator.clipboard is absent in insecure contexts (plain HTTP), hence the execCommand fallback. */
export async function copyToClipboard(text) {
    if (!text) return false;
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return true;
        }
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
    } catch (error) {
        console.error('[TextScene] copy failed:', error);
        return false;
    }
}
