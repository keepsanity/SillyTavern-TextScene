/** Overlay messenger sheet. Messages live in the session until committed to the main chat. */

import { getContext } from '../../../../extensions.js';
import { getThumbnailUrl } from '../../../../../script.js';
import { WHO, DEBUG_PREFIX, REPLY_KIND } from '../constants.js';
import { S } from '../state.js';
import {
    startSession,
    getSession,
    appendMessage,
    updateMessage,
    deleteMessage,
    truncateFrom,
    lastCharBurstStart,
    getTimeShift,
    getPendingMessages,
    markRead,
    hasStoryMovedOn,
    unmarkInsertedFrom,
} from '../store.js';
import { generateReply, abortGeneration } from '../generation.js';
import { getCharName } from '../prompt.js';
import { isTypingEffectEnabled, isAutoEstimateEnabled, getThemeKey, isCatchupEnabled } from '../config.js';
import { applyTheme } from '../themes.js';
import { escapeHtml, sleep, typingDelayFor, copyToClipboard } from '../utils.js';
import { readSceneTime, formatSceneClock, sceneLatestClock } from '../infoblock.js';
import { renderBubbleList, renderTypingIndicator, bindBubbleActions } from './bubble.js';
import { openCommitDialog } from './finish.js';
import { openTimeAdjust, autoEstimateTimeShift, formatDuration } from './timeAdjust.js';

// ============================================
// Open / close
// ============================================

function getAvatarUrl() {
    try {
        const ctx = getContext();
        const character = ctx.characters?.[ctx.characterId];
        if (!character?.avatar) return '';
        return getThumbnailUrl('avatar', character.avatar);
    } catch (error) {
        console.warn(DEBUG_PREFIX, 'avatar lookup failed:', error);
        return '';
    }
}

function buildSheetHTML(session, readonly) {
    const avatar = getAvatarUrl();
    const name = escapeHtml(session.charName || getCharName());
    return `
    <div class="ts-sheet">
        <div class="ts-head">
            <button class="ts-icon-btn" id="ts-close" title="닫기">
                <i class="fa-solid fa-chevron-left"></i>
            </button>
            ${avatar ? `<img class="ts-avatar" src="${escapeHtml(avatar)}" alt="">` : '<div class="ts-avatar ts-avatar-blank"></div>'}
            <div class="ts-head-info">
                <div class="ts-head-name">${name}${readonly ? ' <span class="ts-readonly-tag">지난 문자</span>' : ''}</div>
                <button class="ts-head-time" id="ts-head-time"${readonly ? ' disabled' : ''}></button>
            </div>
            ${readonly ? '' : `
            <button class="ts-icon-btn" id="ts-proactive" title="상대가 먼저 보내게 하기">
                <i class="fa-solid fa-bell"></i>
            </button>
            <button class="ts-btn ts-btn-finish" id="ts-commit">반영</button>`}
        </div>
        <div class="ts-log" id="ts-log">${renderBubbleList(session)}</div>
        ${readonly ? '' : `
        <div class="ts-compose">
            <textarea id="ts-input" class="ts-input" rows="1" placeholder="문자 입력..."></textarea>
            <button class="ts-send" id="ts-send" title="보내기">
                <i class="fa-solid fa-paper-plane" id="ts-send-icon"></i>
            </button>
            <button class="ts-send ts-stop" id="ts-stop" title="생성 중단" style="display:none;">
                <i class="fa-solid fa-stop"></i>
            </button>
        </div>`}
    </div>`;
}

/**
 * Opens the sheet, resuming an unclosed session if there is one.
 * @param {object} [opts]
 * @param {boolean} [opts.proactive] Have the character message first on open
 * @param {string} [opts.sessionId] Open this specific past session
 * @param {boolean} [opts.readonly] View only, no input/generation
 */
export async function openSheet({ proactive = false, sessionId = null, readonly = false } = {}) {
    if (S.isOpen) return;

    let session;
    if (sessionId) {
        session = getSession(sessionId);
        if (!session) {
            if (typeof toastr !== 'undefined') {
                toastr.warning('이 문자의 원문을 찾지 못했어요. 다른 채팅의 기록일 수 있어요.', '문자 씬');
            }
            return;
        }
    } else {
        const ctx = getContext();
        if (ctx.characterId === undefined || ctx.characterId === null || ctx.characterId === '') {
            if (typeof toastr !== 'undefined') {
                toastr.warning('캐릭터 채팅에서만 쓸 수 있어요. 그룹은 아직 안 돼요.', '문자 씬');
            }
            return;
        }
        session = startSession(getCharName());
    }

    S.activeSessionId = session.id;
    S.isReadonly = !!readonly;
    S.isOpen = true;

    const overlay = document.createElement('div');
    overlay.className = 'ts-overlay';
    overlay.innerHTML = buildSheetHTML(session, S.isReadonly);
    document.body.appendChild(overlay);
    S.sheetEl = overlay;
    applyTheme(overlay.querySelector('.ts-sheet'), getThemeKey());

    bindSheetEvents(overlay);
    syncHeight();
    window.addEventListener('resize', syncHeight);
    window.addEventListener('orientationchange', syncHeight);
    scrollToBottom();

    // Whether an estimate is warranted is decided inside autoEstimateTimeShift.
    if (!S.isReadonly && isAutoEstimateEnabled()) {
        const el = S.sheetEl?.querySelector('#ts-head-time');
        if (el) el.textContent = '시간 확인 중...';
        await autoEstimateTimeShift(session.id);
        syncHeadTime();
    }

    if (proactive && !S.isReadonly && !session.messages.length) {
        await requestReply({ proactive: true });
        return;
    }

    if (!S.isReadonly && isCatchupEnabled() && session.messages.length && hasStoryMovedOn(session)) {
        await requestReply({ catchup: true });
    }
}

export function closeSheet() {
    if (!S.isOpen) return;
    window.removeEventListener('resize', syncHeight);
    window.removeEventListener('orientationchange', syncHeight);
    S.sheetEl?.remove();
    S.sheetEl = null;
    S.isOpen = false;
    S.isReadonly = false;
    S.editingId = null;
    S.lastIssue = null;
    S.actionMenuFor = null;
    S.activeSessionId = null;
}

// Mobile 100vh exceeds the visible area; innerHeight avoids soft-keyboard jitter.
function syncHeight() {
    if (S.sheetEl) S.sheetEl.style.height = window.innerHeight + 'px';
}

// ============================================
// Events
// ============================================
function bindSheetEvents(overlay) {
    const log = overlay.querySelector('#ts-log');
    overlay.querySelector('#ts-close').addEventListener('click', () => closeSheet());
    syncHeadTime();
    syncCommitButton();
    syncSendButton();

    if (S.isReadonly) return;

    overlay.querySelector('#ts-head-time').addEventListener('click', async () => {
        if (S.isGenerating || S.isRevealing) return;
        const changed = await openTimeAdjust(S.activeSessionId);
        if (changed) { rerender(); syncHeadTime(); }
    });

    const input = overlay.querySelector('#ts-input');
    overlay.querySelector('#ts-commit').addEventListener('click', () => onCommit());
    overlay.querySelector('#ts-proactive').addEventListener('click', () => requestReply({ proactive: true }));
    overlay.querySelector('#ts-send').addEventListener('click', () => onSendButton());
    overlay.querySelector('#ts-stop').addEventListener('click', () => abortGeneration());

    // Enter sends, Shift+Enter breaks a line; on touch, Enter always breaks a line.
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey && !isProbablyTouch()) {
            event.preventDefault();
            onSend();
        }
    });

    input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 140) + 'px';
        syncSendButton();
    });

    bindBubbleActions(log, (messageId, anchor) => openActionMenu(messageId, anchor));
    bindIssueActions(log);

    // Backdrop clicks must not close the sheet.
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) event.stopPropagation();
    });
}

function isProbablyTouch() {
    return window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
}

// ============================================
// Render
// ============================================
function getLogEl() {
    return S.sheetEl?.querySelector('#ts-log') ?? null;
}

export function rerender() {
    // Re-rendering mid-edit would discard the in-progress edit.
    if (S.editingId) return;
    const log = getLogEl();
    const session = getSession(S.activeSessionId);
    if (!log || !session) return;
    log.innerHTML = renderBubbleList(session) + renderIssue();
    scrollToBottom();
}

/** In-place error notice; there is no console to read on mobile. */
function renderIssue() {
    const issue = S.lastIssue;
    if (!issue) return '';
    return `
    <div class="ts-issue">
        <div class="ts-issue-head"><i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(issue.reason)}</div>
        <div class="ts-issue-detail">${escapeHtml(issue.detail)}</div>
        <div class="ts-issue-actions">
            ${issue.raw ? '<button class="ts-btn ts-btn-mini2" data-issue="raw">모델 응답 보기</button>' : ''}
            ${issue.request ? '<button class="ts-btn ts-btn-mini2" data-issue="req">보낸 요청 보기</button>' : ''}
            <button class="ts-btn ts-btn-mini2" data-issue="dismiss">닫기</button>
        </div>
    </div>`;
}

function bindIssueActions(log) {
    log.addEventListener('click', async (event) => {
        const act = event.target.closest('[data-issue]')?.dataset.issue;
        if (!act) return;
        if (act === 'dismiss') {
            S.lastIssue = null;
            rerender();
            return;
        }
        if (act === 'req') {
            const req = S.lastIssue?.request ?? '';
            const ok = await copyToClipboard(req);
            alert(req || '(기록 없음)');
            if (ok && typeof toastr !== 'undefined') toastr.success('요청을 복사했어요.', '문자 씬');
            return;
        }
        if (act === 'raw') {
            const raw = S.lastIssue?.raw ?? '';
            const ok = await copyToClipboard(raw);
            alert(raw || '(빈 응답)');
            if (ok && typeof toastr !== 'undefined') toastr.success('응답을 복사했어요.', '문자 씬');
        }
    });
}

/** Header in-story time: first message's clock, else the shift from the previous scene. */
export function syncHeadTime() {
    const el = S.sheetEl?.querySelector('#ts-head-time');
    if (!el) return;
    const session = getSession(S.activeSessionId);

    const clock = sceneLatestClock(session);
    if (clock) {
        el.textContent = S.isReadonly ? clock : `${clock} ▾`;
        el.style.display = '';
        return;
    }

    // With no messages yet, preview the time a message sent now would carry.
    const sceneMin = readSceneTime();
    if (sceneMin === null || S.isReadonly) { el.style.display = 'none'; return; }
    const shift = getTimeShift(session);
    el.textContent = `${formatSceneClock(sceneMin + shift)} · ${formatDuration(shift)} ▾`;
    el.style.display = '';
}

function scrollToBottom() {
    const log = getLogEl();
    if (log) log.scrollTop = log.scrollHeight;
}

function setBusy(busy) {
    const overlay = S.sheetEl;
    if (!overlay || S.isReadonly) return;

    const send = overlay.querySelector('#ts-send');
    const stop = overlay.querySelector('#ts-stop');
    if (send) send.style.display = busy ? 'none' : '';
    if (stop) stop.style.display = busy ? '' : 'none';
    const proactive = overlay.querySelector('#ts-proactive');
    const commit = overlay.querySelector('#ts-commit');
    if (proactive) proactive.disabled = busy;
    if (commit) commit.disabled = busy;
}

function showTyping(show) {
    const log = getLogEl();
    if (!log) return;
    log.querySelector('.ts-typing-row')?.remove();
    if (show) {
        log.insertAdjacentHTML('beforeend', renderTypingIndicator());
        scrollToBottom();
    }
}

// ============================================
// Send / generate
// ============================================
async function onSend() {
    if (S.isGenerating || S.isRevealing) return;
    const input = S.sheetEl?.querySelector('#ts-input');
    const text = String(input?.value ?? '').trim();
    if (!text) return;

    S.lastIssue = null;
    appendMessage(S.activeSessionId, WHO.USER, text);
    input.value = '';
    input.style.height = 'auto';
    rerender();
    syncHeadTime();
    syncCommitButton();
    syncSendButton();

    await requestReply({ proactive: false });
}

async function requestReply({ proactive = false, catchup = false } = {}) {
    if (S.isGenerating || S.isRevealing) return;

    const session = getSession(S.activeSessionId);
    if (!session) return;

    setBusy(true);
    S.skipReveal = false;
    showTyping(true);

    let bubbles = [];
    let delayMinutes = null;
    let kind = REPLY_KIND.REPLY;
    try {
        ({ bubbles, delayMinutes, kind } = await generateReply(session, { proactive, catchup }));
    } catch (error) {
        showTyping(false);
        setBusy(false);
        // A user-triggered abort is not an error.
        if (S.skipReveal) S.lastIssue = null;
        else console.error(DEBUG_PREFIX, 'generation failed:', error);
        rerender();
        syncSendButton();
        return;
    }

    showTyping(false);

    if (kind === REPLY_KIND.NONE) {
        setBusy(false);
        syncSendButton();
        return;
    }

    // SILENT only flips the read marker; UNREAD leaves it as-is.
    if (kind === REPLY_KIND.SILENT || kind === REPLY_KIND.UNREAD) {
        if (kind === REPLY_KIND.SILENT) markRead(S.activeSessionId);
        rerender();
        setBusy(false);
        syncSendButton();
        return;
    }

    if (!bubbles.length) {
        setBusy(false);
        rerender();
        syncSendButton();
        return;
    }

    S.lastIssue = null;
    markRead(S.activeSessionId);
    await revealBubbles(bubbles, delayMinutes);
    setBusy(false);
    syncSendButton();
}

/** `delayMinutes` is attached to the first bubble only; the rest land in the same beat. */
async function revealBubbles(bubbles, delayMinutes = null) {
    const animate = isTypingEffectEnabled();
    S.isRevealing = true;
    try {
        for (let i = 0; i < bubbles.length; i++) {
            if (animate && !S.skipReveal) {
                // The first bubble already showed an indicator, so halve its delay.
                showTyping(true);
                await sleep(typingDelayFor(bubbles[i]) / (i === 0 ? 2 : 1));
                showTyping(false);
            }
            appendMessage(S.activeSessionId, WHO.CHAR, bubbles[i], {
                delayMinutes: i === 0 ? delayMinutes : 0,
            });
            rerender();
            syncHeadTime();
            syncCommitButton();
        }
    } finally {
        showTyping(false);
        S.isRevealing = false;
        S.skipReveal = false;
    }
}

// ============================================
// Bubble action menu
// ============================================
function openActionMenu(messageId, anchor) {
    if (!messageId || S.isReadonly || S.isGenerating || S.isRevealing || S.editingId) return;
    closeActionMenu();

    const session = getSession(S.activeSessionId);
    const message = session?.messages.find(m => m.id === messageId);
    if (!message) return;

    const burstStart = lastCharBurstStart(session);
    const canRegenerate = burstStart !== -1 && session.messages[burstStart].id === messageId;

    const menu = document.createElement('div');
    menu.className = 'ts-menu';
    menu.innerHTML = `
        <button class="ts-menu-item" data-act="copy"><i class="fa-solid fa-copy"></i> 복사</button>
        <button class="ts-menu-item" data-act="edit"><i class="fa-solid fa-pen"></i> 수정</button>
        <button class="ts-menu-item" data-act="delete"><i class="fa-solid fa-trash"></i> 삭제</button>
        ${canRegenerate ? '<button class="ts-menu-item" data-act="regen"><i class="fa-solid fa-rotate"></i> 답장 다시 받기</button>' : ''}
        ${message.inserted ? '<button class="ts-menu-item" data-act="uncommit"><i class="fa-solid fa-rotate-left"></i> 여기부터 다시 반영</button>' : ''}
        <button class="ts-menu-item" data-act="truncate"><i class="fa-solid fa-scissors"></i> 여기부터 지우기</button>
    `;
    S.sheetEl.appendChild(menu);
    S.actionMenuFor = messageId;

    positionMenu(menu, anchor);

    menu.addEventListener('click', async (event) => {
        const act = event.target.closest('.ts-menu-item')?.dataset.act;
        if (!act) return;
        closeActionMenu();
        await runAction(act, messageId);
    });

    // Bound on the next tick so the click currently in progress does not close it.
    setTimeout(() => {
        document.addEventListener('click', closeActionMenu, { once: true });
    }, 0);
}

function positionMenu(menu, anchor) {
    const rect = anchor.getBoundingClientRect();
    const sheetRect = S.sheetEl.getBoundingClientRect();
    const menuHeight = menu.offsetHeight || 140;
    const below = rect.bottom - sheetRect.top + 6;
    const above = rect.top - sheetRect.top - menuHeight - 6;
    const top = (rect.bottom + menuHeight + 12 > window.innerHeight && above > 0) ? above : below;
    menu.style.top = `${Math.max(6, top)}px`;
    menu.style.left = `${Math.max(6, Math.min(rect.left - sheetRect.left, sheetRect.width - (menu.offsetWidth || 180) - 6))}px`;
}

function closeActionMenu() {
    S.sheetEl?.querySelector('.ts-menu')?.remove();
    S.actionMenuFor = null;
}

async function runAction(act, messageId) {
    const session = getSession(S.activeSessionId);
    if (!session) return;

    if (act === 'copy') {
        const message = session.messages.find(m => m.id === messageId);
        const ok = await copyToClipboard(message?.text ?? '');
        if (typeof toastr !== 'undefined') {
            if (ok) toastr.success('복사했어요.', '문자 씬');
            else toastr.error('복사하지 못했어요.', '문자 씬');
        }
        return;
    }

    if (act === 'edit') {
        startInlineEdit(messageId);
        return;
    }

    if (act === 'delete') {
        deleteMessage(S.activeSessionId, messageId);
        rerender();
        syncCommitButton();
        syncSendButton();
        return;
    }

    if (act === 'uncommit') {
        unmarkInsertedFrom(S.activeSessionId, messageId);
        rerender();
        syncCommitButton();
        if (typeof toastr !== 'undefined') {
            const count = getPendingMessages(getSession(S.activeSessionId)).length;
            toastr.info(`${count}통이 다시 반영 대상이 됐어요.`, '문자 씬');
        }
        return;
    }

    if (act === 'truncate') {
        truncateFrom(S.activeSessionId, messageId);
        rerender();
        syncCommitButton();
        syncSendButton();
        return;
    }

    if (act === 'regen') {
        truncateFrom(S.activeSessionId, messageId);
        rerender();
        await requestReply({ proactive: !getSession(S.activeSessionId)?.messages.length });
    }
}

// ============================================
// Editing a message (in place)
// ============================================

function startInlineEdit(messageId) {
    const log = getLogEl();
    const session = getSession(S.activeSessionId);
    const message = session?.messages.find(m => m.id === messageId);
    const row = log?.querySelector(`.ts-row[data-id="${CSS.escape(messageId)}"]`);
    if (!row || !message) return;

    S.editingId = messageId;
    const side = message.who === WHO.CHAR ? 'char' : 'user';
    row.classList.add('ts-row-editing');
    row.innerHTML = `
        <div class="ts-edit ts-edit-${side}">
            <textarea class="ts-edit-input" id="ts-edit-input"></textarea>
            <div class="ts-edit-actions">
                <button class="ts-btn ts-btn-mini2" data-act="cancel">취소</button>
                <button class="ts-btn ts-btn-mini2 ts-btn-primary" data-act="save">저장</button>
            </div>
        </div>`;

    const input = row.querySelector('#ts-edit-input');
    // Set via the DOM to avoid escaping issues in the template.
    input.value = message.text;

    const grow = () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 220) + 'px';
    };
    grow();
    input.addEventListener('input', grow);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);

    const stop = () => {
        S.editingId = null;
        rerender();
    };

    const save = () => {
        const next = input.value.trim();
        // Clearing the text deletes the message.
        if (!next) deleteMessage(S.activeSessionId, messageId);
        else updateMessage(S.activeSessionId, messageId, next);
        stop();
    };

    row.querySelector('.ts-edit-actions').addEventListener('click', (event) => {
        const act = event.target.closest('[data-act]')?.dataset.act;
        if (act === 'save') save();
        else if (act === 'cancel') stop();
    });

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') { event.preventDefault(); stop(); }
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); save(); }
    });

    row.scrollIntoView({ block: 'nearest' });
}

// ============================================
// Commit to RP
// ============================================

/** Hands pending messages to the main chat. The sheet stays open afterwards. */
async function onCommit() {
    const session = getSession(S.activeSessionId);
    if (!session) return;

    const pending = getPendingMessages(session);
    if (!pending.length) {
        if (typeof toastr !== 'undefined') {
            toastr.info('아직 새로 주고받은 문자가 없어요.', '문자 씬');
        }
        return;
    }

    const done = await openCommitDialog(session);
    if (done) {
        rerender();
        syncCommitButton();
    }
}

/** The send button doubles as a retry when the input is empty and a reply is awaited. */
export function syncSendButton() {
    const overlay = S.sheetEl;
    if (!overlay || S.isReadonly) return;
    const input = overlay.querySelector('#ts-input');
    const icon = overlay.querySelector('#ts-send-icon');
    const button = overlay.querySelector('#ts-send');
    if (!input || !icon || !button) return;

    const messages = getSession(S.activeSessionId)?.messages ?? [];
    const last = messages[messages.length - 1];
    const canRetry = !input.value.trim()
        && !!last && last.who === WHO.USER
        && !S.isGenerating && !S.isRevealing;

    button.classList.toggle('ts-send-retry', canRetry);
    icon.className = canRetry ? 'fa-solid fa-rotate' : 'fa-solid fa-paper-plane';
    button.title = canRetry ? '답장 받기' : '보내기';
}

async function onSendButton() {
    const input = S.sheetEl?.querySelector('#ts-input');
    if (input && !input.value.trim()) {
        const messages = getSession(S.activeSessionId)?.messages ?? [];
        const last = messages[messages.length - 1];
        if (last && last.who === WHO.USER) {
            await requestReply({});
        }
        return;
    }
    await onSend();
}

export function syncCommitButton() {
    const btn = S.sheetEl?.querySelector('#ts-commit');
    if (!btn) return;
    const pending = getPendingMessages(getSession(S.activeSessionId));
    btn.disabled = pending.length === 0;
    btn.textContent = pending.length ? `반영 ${pending.length}` : '반영';
}
