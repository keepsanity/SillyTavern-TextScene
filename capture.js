/** Button on an inserted text block that reopens the original session read-only. */

import { eventSource, event_types, chat } from '../../../../script.js';
import { INSERT_MARKER, HISTORY_BTN_CLASS } from './constants.js';
import { openSheet } from './ui/sheet.js';

/** sessionId if this message was inserted from a text scene, otherwise null. */
function getSessionIdFor(mesEl) {
    const idx = Number(mesEl?.getAttribute('mesid'));
    if (!Number.isInteger(idx) || idx < 0 || idx >= chat.length) return null;
    return chat[idx]?.extra?.[INSERT_MARKER]?.sessionId ?? null;
}

// Placed below the message body rather than in ST's `.extraMesButtons`, which is
// display:none until the message's `⋯` is tapped.
export function injectHistoryButton(mesEl) {
    if (!mesEl) return;
    if (!getSessionIdFor(mesEl)) return;
    const text = mesEl.querySelector('.mes_text');
    if (!text || text.parentElement?.querySelector('.' + HISTORY_BTN_CLASS)) return;

    const bar = document.createElement('div');
    bar.className = HISTORY_BTN_CLASS + '-bar';
    bar.innerHTML = `
        <button type="button" class="${HISTORY_BTN_CLASS}">
            <i class="fa-solid fa-comment-sms"></i> 문자 원문 보기
        </button>`;
    text.insertAdjacentElement('afterend', bar);
}

export function refreshHistoryButtons() {
    document.querySelectorAll('#chat .mes').forEach(injectHistoryButton);
}

export function setupHistoryButtons() {
    // Delegated once on document so it survives message re-renders.
    document.addEventListener('click', (event) => {
        const btn = event.target.closest('.' + HISTORY_BTN_CLASS);
        if (!btn) return;
        const sessionId = getSessionIdFor(btn.closest('.mes'));
        if (!sessionId) return;
        openSheet({ sessionId, readonly: true });
    });

    const reinject = () => refreshHistoryButtons();
    eventSource.on(event_types.CHAT_CHANGED, reinject);
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, reinject);
    eventSource.on(event_types.USER_MESSAGE_RENDERED, reinject);
    eventSource.on(event_types.MESSAGE_SWIPED, reinject);
    eventSource.on(event_types.MORE_MESSAGES_LOADED, reinject);
    eventSource.on(event_types.MESSAGE_UPDATED, reinject);

    refreshHistoryButtons();
}
