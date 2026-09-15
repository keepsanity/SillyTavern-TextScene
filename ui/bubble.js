import { t } from '../i18n.js';

/** Chat bubble rendering + bubble action menu. */

import { WHO, GAP_NOTE_MINUTES } from '../constants.js';
import { escapeHtml } from '../utils.js';
import { sceneClockFor, sceneDateFor } from '../infoblock.js';
import { getCommitBatch } from '../commits.js';

const LONG_PRESS_MS = 450;
/** Movement beyond this distance (px) counts as a scroll and cancels the long press. */
const LONG_PRESS_SLOP = 10;

/** Timestamp is in-story time from the infoblock; omitted when unreadable. */
export function renderBubble(message, session) {
    if (message.kind) return `<div class="ts-row ts-phone-event" data-id="${escapeHtml(message.id)}">${escapeHtml(message.clock || '')} · ${message.kind === 'silent' ? t("읽음 · 답장 없음") : t("아직 읽지 않음")}</div>`;
    const side = message.who === WHO.CHAR ? 'char' : 'user';
    const clock = sceneClockFor(session, message);
    const unread = message.who === WHO.USER && !message.read;
    return `
    <div class="ts-row ts-row-${side}${message.inserted ? ' ts-row-inserted' : ''}" data-id="${escapeHtml(message.id)}">
        <div class="ts-bubble ts-bubble-${side}">${escapeHtml(message.text)}</div>
        <div class="ts-meta">
            ${unread ? `<span class="ts-unread" title="${t("아직 읽지 않음")}">1</span>` : ''}
            ${clock ? `<span class="ts-time">${escapeHtml(clock)}</span>` : ''}
        </div>
    </div>`;
}

function renderGapNote(minutes) {
    const m = Math.round(minutes);
    if (m < GAP_NOTE_MINUTES) return '';
    let label;
    if (m < 60) label = `${m}${t("분 뒤")}`;
    else if (m < 1440) {
        const h = Math.floor(m / 60);
        const rest = m % 60;
        label = rest ? `${h}${t("시간")} ${rest}${t("분 뒤")}` : `${h}${t("시간 뒤")}`;
    } else {
        label = `${Math.floor(m / 1440)}${t("일 뒤")}`;
    }
    return `<div class="ts-gap-note">${escapeHtml(label)}</div>`;
}

function renderDateDivider(text) {
    return `<div class="ts-date-divider"><span>${escapeHtml(text)}</span></div>`;
}

export function renderBubbleList(session) {
    if (!session?.messages?.length) {
        return `<div class="ts-empty">${t("아직 주고받은 문자가 없어요.")}</div>`;
    }

    const parts = [];
    const pending = new Set(getCommitBatch(session).messages.map(m => m.id));
    const displayed = session.messages.map(m => pending.has(m.id) ? { ...m, inserted: false } : m);
    const hasCommitted = displayed.some(m => m.inserted);
    let shownDate = null;
    let markedCommitLine = false;
    let prevSceneMin = null;
    for (const message of displayed) {
        if (!markedCommitLine && !message.inserted && hasCommitted) {
            parts.push(`<div class="ts-commit-line"><span>${t("여기까지 RP 에 반영됨")}</span></div>`);
            markedCommitLine = true;
        }
        const date = sceneDateFor(session, message);
        const dateChanged = date && date !== shownDate;
        if (dateChanged) {
            parts.push(renderDateDivider(date));
            shownDate = date;
        }
        // A date divider already conveys the gap, so don't stack a gap note on it.
        if (!dateChanged && prevSceneMin != null && message.sceneMin != null) {
            parts.push(renderGapNote(message.sceneMin - prevSceneMin));
        }
        if (message.sceneMin != null) prevSceneMin = message.sceneMin;
        parts.push(renderBubble(message, session));
    }
    return parts.join('');
}

export function renderTypingIndicator() {
    return `
    <div class="ts-row ts-row-char ts-typing-row">
        <div class="ts-bubble ts-bubble-char ts-typing">
            <span></span><span></span><span></span>
        </div>
    </div>`;
}

/**
 * Delegates long-press detection to the list container.
 * @param {HTMLElement} container
 * @param {(messageId: string, anchor: HTMLElement) => void} onAction
 */
export function bindBubbleActions(container, onAction) {
    let timer = null;
    let startX = 0;
    let startY = 0;
    let target = null;
    let fired = false;

    const clear = () => {
        if (timer) clearTimeout(timer);
        timer = null;
        target = null;
    };

    const start = (event) => {
        const row = event.target.closest?.('.ts-row');
        if (!row || row.classList.contains('ts-typing-row')) return;
        const point = event.touches?.[0] ?? event;
        startX = point.clientX;
        startY = point.clientY;
        target = row;
        fired = false;
        timer = setTimeout(() => {
            fired = true;
            timer = null;
            try { navigator.vibrate?.(15); } catch { /* noop */ }
            onAction(row.dataset.id, row);
        }, LONG_PRESS_MS);
    };

    const move = (event) => {
        if (!timer) return;
        const point = event.touches?.[0] ?? event;
        if (Math.abs(point.clientX - startX) > LONG_PRESS_SLOP ||
            Math.abs(point.clientY - startY) > LONG_PRESS_SLOP) {
            clear();
        }
    };

    container.addEventListener('touchstart', start, { passive: true });
    container.addEventListener('touchmove', move, { passive: true });
    container.addEventListener('touchend', clear);
    container.addEventListener('touchcancel', clear);
    container.addEventListener('mousedown', start);
    container.addEventListener('mousemove', move);
    container.addEventListener('mouseup', clear);
    container.addEventListener('mouseleave', clear);

    container.addEventListener('click', (event) => {
        if (!fired) return;
        // Swallow the click that ends a long press, or the menu closes immediately.
        event.preventDefault();
        event.stopPropagation();
        fired = false;
    }, true);

    container.addEventListener('contextmenu', (event) => {
        const row = event.target.closest?.('.ts-row');
        if (!row || row.classList.contains('ts-typing-row')) return;
        event.preventDefault();
        clear();
        onAction(row.dataset.id, row);
    });
}
