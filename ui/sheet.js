import { t } from '../i18n.js';

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
    saveSessions,
    closeSession,
    getSessions,
    storyRevision,
    markCatchupChecked,
} from '../store.js';
import { getCommitBatch, getCommits, hasPendingChanges } from '../commits.js';
import { captureOwner, withAbort } from '../lifecycle.js';
import { uuidv4 } from '../../../../utils.js';
import { persistChat } from '../persistence.js';
import { generateReply, abortGeneration, generateSceneContext } from '../generation.js';
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
            <button class="ts-icon-btn" id="ts-close" title="${t("닫기")}">
                <i class="fa-solid fa-chevron-left"></i>
            </button>
            ${avatar ? `<img class="ts-avatar" src="${escapeHtml(avatar)}" alt="">` : '<div class="ts-avatar ts-avatar-blank"></div>'}
            <div class="ts-head-info">
                <div class="ts-head-name">${name}${readonly ? ` <span class="ts-readonly-tag">${t("지난 문자")}</span>` : ''}</div>
                <button class="ts-head-time" id="ts-head-time"${readonly ? ' disabled' : ''}></button>
            </div>
            ${readonly ? '' : `
            <button class="ts-icon-btn" id="ts-proactive" title="${t("상대가 먼저 보내게 하기")}">
                <i class="fa-solid fa-bell"></i>
            </button>
            <button class="ts-btn ts-btn-finish" id="ts-commit">${t("반영")}</button>`}
        </div>
        ${readonly ? '' : `
        <details class="ts-options">
            <summary>${t("진행 · 상황 · 지난 장면")}</summary>
            <label for="ts-context-note">${t("현재 상황 · 서로 아는 사실 · 미결 약속")}</label>
            <textarea id="ts-context-note" rows="3" placeholder="${t("예: 각자 귀가함. 내일 7시 약속은 아직 제안 단계.")}"></textarea>
            <button class="ts-btn" id="ts-context-refresh">${t("최근 상황 읽어오기")}</button>
            <small class="ts-note">${t("읽어온 메모는 직접 고칠 수 있습니다. 캐릭터가 모르는 사실과 추정을 확인해 주세요.")}</small>
            <label for="ts-intent">${t("마무리 방향")}</label>
            <select id="ts-intent">
                <option value="">${t("직접 입력")}</option>
                <option>${t("다정하게 잘 자 인사로 마무리하기")}</option>
                <option>${t("상대를 안심시키고 자연스럽게 마무리하기")}</option>
                <option>${t("미결 약속을 확인하되 내 동의를 대신 정하지 않기")}</option>
            </select>
            <input id="ts-intent-custom" type="text" maxlength="800" placeholder="${t("원하는 방향을 입력하세요")}">
            <div class="ts-option-actions">
                <button class="ts-btn" id="ts-wrap">${t("마무리 답장 받기")}</button>
                <button class="ts-btn" id="ts-end">${t("반영하고 장면 끝내기")}</button>
            </div>
            <label for="ts-history">${t("지난 문자 장면")}</label>
            <select id="ts-history"><option value="">${t("기록 선택")}</option>${getSessions().filter(s => s.closed).slice().reverse().map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.charName)} · ${escapeHtml(s.messages[0]?.date || new Date(s.startedAt).toLocaleDateString())} · ${s.messages.length}${t("통")}</option>`).join('')}</select>
        </details>`}
        <div id="ts-revisions">${renderRevisions(session)}</div>
        <div class="ts-log" id="ts-log">${renderBubbleList(session)}</div>
        ${readonly ? '' : `
        <div class="ts-compose-tools">
            <label><input id="ts-bundle" type="checkbox"${session.bundleMode ? ' checked' : ''}> ${t("묶어 보내기")}</label>
            <button class="ts-btn" id="ts-request"${session.bundleMode ? '' : ' hidden'}>${t("답장 받기")}</button>
        </div>
        <div class="ts-compose">
            <textarea id="ts-input" class="ts-input" rows="1" placeholder="${t("문자 입력...")}"></textarea>
            <button class="ts-send" id="ts-send" title="${t("보내기")}">
                <i class="fa-solid fa-paper-plane" id="ts-send-icon"></i>
            </button>
            <button class="ts-send ts-stop" id="ts-stop" title="${t("생성 중단")}" style="display:none;">
                <i class="fa-solid fa-stop"></i>
            </button>
        </div>`}
    </div>`;
}

function renderRevisions(session) {
    const revisions = getCommits(session).flatMap(c => c.revisions ?? []);
    if (!revisions.length) return '';
    return `<details class="ts-revision-history"><summary>${t("이전 반영 내용 (")}${revisions.length})</summary>${revisions.slice().reverse().map(r => `<p>${escapeHtml(new Date(r.at).toLocaleString())}</p><pre>${escapeHtml(r.text)}</pre>`).join('')}</details>`;
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
                toastr.warning(t("이 문자의 원문을 찾지 못했어요. 다른 채팅의 기록일 수 있어요."), t("문자 씬"));
            }
            return;
        }
    } else {
        const ctx = getContext();
        if (ctx.groupId || ctx.characterId === undefined || ctx.characterId === null || ctx.characterId === '') {
            if (typeof toastr !== 'undefined') {
                toastr.warning(t("캐릭터 채팅에서만 쓸 수 있어요. 그룹은 아직 안 돼요."), t("문자 씬"));
            }
            return;
        }
        session = startSession(getCharName());
    }

    S.activeSessionId = session.id;
    S.isReadonly = !!readonly;
    S.isOpen = true;
    S.viewEpoch++;
    const owner = captureOwner(session, { view: true });
    S.owner = owner;
    if (!readonly && hasStoryMovedOn(session)) session.resumeScene = true;

    const overlay = document.createElement('div');
    overlay.className = 'ts-overlay';
    overlay.innerHTML = buildSheetHTML(session, S.isReadonly);
    document.body.appendChild(overlay);
    S.sheetEl = overlay;
    if (!readonly) {
        overlay.querySelector('#ts-input').value = session.draft || '';
        overlay.querySelector('#ts-context-note').value = session.contextNote || '';
    }
    applyTheme(overlay.querySelector('.ts-sheet'), getThemeKey());

    bindSheetEvents(overlay);
    syncHeight();
    window.addEventListener('resize', syncHeight);
    window.addEventListener('orientationchange', syncHeight);
    scrollToBottom();

    // Whether an estimate is warranted is decided inside autoEstimateTimeShift.
    if (!S.isReadonly && isAutoEstimateEnabled()) {
        const el = S.sheetEl?.querySelector('#ts-head-time');
        if (el) el.textContent = t("시간 확인 중...");
        setBusy(true);
        await autoEstimateTimeShift(session.id);
        if (!owner()) return;
        setBusy(false);
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
    if (S.owner?.() && !S.isReadonly) {
        const session = getSession(S.activeSessionId);
        if (session) { session.draft = S.sheetEl?.querySelector('#ts-input')?.value || ''; saveSessions(); }
    }
    abortGeneration();
    for (const close of [...S.dialogs]) close();
    S.viewEpoch++;
    S.isRevealing = false;
    S.revealCount = null;
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
    S.owner = null;
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
    overlay.querySelector('#ts-bundle').addEventListener('change', event => {
        const session = getSession(S.activeSessionId);
        if (!session) return;
        session.bundleMode = event.target.checked;
        overlay.querySelector('#ts-request').hidden = !session.bundleMode;
        saveSessions();
        syncSendButton();
    });
    overlay.querySelector('#ts-request').addEventListener('click', () => onRequest());
    overlay.querySelector('#ts-context-note').addEventListener('input', event => {
        const session = getSession(S.activeSessionId);
        if (session) { session.contextNote = event.target.value; saveSessions(); }
    });
    overlay.querySelector('#ts-context-refresh').addEventListener('click', async () => {
        if (isBusy()) return;
        const session = getSession(S.activeSessionId);
        if (!session) return;
        const owner = captureOwner(session, { view: true });
        const input = overlay.querySelector('#ts-context-note');
        const before = input.value;
        setBusy(true);
        try {
            const note = await generateSceneContext(session);
            if (!owner()) return;
            if (input.value !== before) { toastr.info(t("직접 수정한 메모를 유지했어요. 필요하면 다시 읽어오세요."), t("문자 씬")); return; }
            session.contextNote = note;
            input.value = note;
            saveSessions();
        } catch (error) {
            if (owner() && error?.name !== 'AbortError') toastr.error(String(error?.message || error), t("문자 씬"));
        } finally { if (owner()) setBusy(false); }
    });
    overlay.querySelector('#ts-wrap').addEventListener('click', async () => {
        const intent = overlay.querySelector('#ts-intent-custom').value.trim() || overlay.querySelector('#ts-intent').value;
        if (!intent) { toastr.info(t("마무리 방향을 선택하거나 입력해 주세요."), t("문자 씬")); return; }
        await onRequest({ intent });
    });
    overlay.querySelector('#ts-end').addEventListener('click', () => onCommit({ endScene: true }));
    overlay.querySelector('#ts-history').addEventListener('change', event => {
        if (!event.target.value || isBusy()) return;
        const sessionId = event.target.value;
        closeSheet();
        openSheet({ sessionId, readonly: true });
    });

    // Enter sends, Shift+Enter breaks a line; on touch, Enter always breaks a line.
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229 && !event.shiftKey && !isProbablyTouch()) {
            event.preventDefault();
            onSend();
        }
    });

    input.addEventListener('input', () => {
        const session = getSession(S.activeSessionId);
        if (session) { session.draft = input.value; saveSessions(); }
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
    const visible = S.revealCount == null ? session : { ...session, messages: session.messages.slice(0, S.revealCount) };
    log.innerHTML = renderBubbleList(visible) + renderIssue();
    const revisions = S.sheetEl?.querySelector('#ts-revisions');
    if (revisions) revisions.innerHTML = renderRevisions(session);
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
            ${issue.raw ? `<button class="ts-btn ts-btn-mini2" data-issue="raw">${t("모델 응답 보기")}</button>` : ''}
            ${issue.request ? `<button class="ts-btn ts-btn-mini2" data-issue="req">${t("보낸 요청 보기")}</button>` : ''}
            <button class="ts-btn ts-btn-mini2" data-issue="dismiss">${t("닫기")}</button>
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
            alert(req || t("(기록 없음)"));
            if (ok && typeof toastr !== 'undefined') toastr.success(t("요청을 복사했어요."), t("문자 씬"));
            return;
        }
        if (act === 'raw') {
            const raw = S.lastIssue?.raw ?? '';
            const ok = await copyToClipboard(raw);
            alert(raw || t("(빈 응답)"));
            if (ok && typeof toastr !== 'undefined') toastr.success(t("응답을 복사했어요."), t("문자 씬"));
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
    for (const id of ['ts-request', 'ts-wrap', 'ts-end', 'ts-bundle', 'ts-head-time', 'ts-history', 'ts-context-refresh']) {
        const el = overlay.querySelector('#' + id);
        if (el) el.disabled = busy;
    }
    if (!busy) syncCommitButton();
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
    if (isBusy()) return;
    const input = S.sheetEl?.querySelector('#ts-input');
    const text = String(input?.value ?? '').trim();
    if (!text) return;

    S.lastIssue = null;
    appendMessage(S.activeSessionId, WHO.USER, text);
    const session = getSession(S.activeSessionId);
    if (session) session.draft = '';
    input.value = '';
    input.style.height = 'auto';
    rerender();
    syncHeadTime();
    syncCommitButton();
    syncSendButton();

    if (!session?.bundleMode) await requestReply({ proactive: false });
}

function isBusy() {
    return S.isGenerating || S.isRevealing || S.isEstimating || S.isSummarizing || S.isCommitting;
}

async function onRequest(options = {}) {
    if (isBusy()) return;
    const session = getSession(S.activeSessionId);
    if (!session) return;
    const input = S.sheetEl?.querySelector('#ts-input');
    const text = input?.value.trim();
    if (text) {
        appendMessage(session.id, WHO.USER, text);
        input.value = '';
        session.draft = '';
        saveSessions();
        rerender();
    }
    await requestReply(options);
}

async function requestReply({ proactive = false, catchup = false, intent = '', replaceFrom = null } = {}) {
    if (isBusy()) return;
    const session = getSession(S.activeSessionId);
    if (!session) return;
    const owner = captureOwner(session, { view: true });
    const revision = storyRevision();
    setBusy(true);
    showTyping(true);
    const messages = replaceFrom == null ? null : session.messages.slice(0, replaceFrom);
    try {
        const result = await generateReply(session, { proactive, catchup, intent, messages });
        if (!owner()) return;
        markCatchupChecked(session, revision);
        if (result.kind === REPLY_KIND.NONE) return;
        // Only remove the old burst AFTER a valid replacement has arrived.
        if (replaceFrom != null && result.kind === REPLY_KIND.REPLY) {
            const first = session.messages[replaceFrom];
            if (first) truncateFrom(session.id, first.id);
        }
        if (result.kind === REPLY_KIND.SILENT || result.kind === REPLY_KIND.UNREAD) {
            if (result.kind === REPLY_KIND.SILENT) markRead(session.id);
            appendMessage(session.id, WHO.CHAR, '', { kind: result.kind, delayMinutes: result.delayMinutes });
            rerender();
            syncHeadTime();
            return;
        }
        S.lastIssue = null;
        markRead(session.id);
        await revealBubbles(session, result.bubbles, result.delayMinutes, owner);
    } catch (error) {
        if (owner() && error?.name !== 'AbortError') console.error(DEBUG_PREFIX, 'generation failed:', error);
    } finally {
        if (owner()) {
            showTyping(false);
            setBusy(false);
            rerender();
            syncHeadTime();
            syncSendButton();
        }
    }
}

/** Persist the complete burst before cosmetic reveal. Closing cannot lose or misroute bubbles. */
async function revealBubbles(session, bubbles, delayMinutes, owner) {
    const controller = new AbortController();
    S.revealController = controller;
    S.isRevealing = true;
    const start = session.messages.length;
    const burstId = uuidv4();
    for (let i = 0; i < bubbles.length; i++) {
        appendMessage(session.id, WHO.CHAR, bubbles[i], { delayMinutes: i === 0 ? delayMinutes : 0, burstId });
    }
    try {
        if (isTypingEffectEnabled()) {
            for (let i = 0; i < bubbles.length; i++) {
                if (!owner()) return;
                S.revealCount = start + i;
                rerender();
                showTyping(true);
                await withAbort(sleep(typingDelayFor(bubbles[i]) / (i === 0 ? 2 : 1)), controller.signal);
            }
        }
    } catch (error) {
        if (error?.name !== 'AbortError') throw error;
    } finally {
        if (S.revealController === controller) {
            S.revealController = null;
            S.revealCount = null;
            S.isRevealing = false;
        }
        if (owner()) { showTyping(false); rerender(); syncHeadTime(); syncCommitButton(); }
    }
}

// ============================================
// Bubble action menu
// ============================================
function openActionMenu(messageId, anchor) {
    if (!messageId || S.isReadonly || isBusy() || S.editingId) return;
    closeActionMenu();

    const session = getSession(S.activeSessionId);
    const message = session?.messages.find(m => m.id === messageId);
    if (!message) return;

    const burstStart = lastCharBurstStart(session);
    const canRegenerate = burstStart !== -1 && session.messages[burstStart].id === messageId;

    const menu = document.createElement('div');
    menu.className = 'ts-menu';
    menu.innerHTML = `
        ${message.kind ? '' : `<button class="ts-menu-item" data-act="copy"><i class="fa-solid fa-copy"></i> ${t("복사")}</button><button class="ts-menu-item" data-act="edit"><i class="fa-solid fa-pen"></i> ${t("수정")}</button>`}
        <button class="ts-menu-item" data-act="delete"><i class="fa-solid fa-trash"></i> ${t("삭제")}</button>
        ${canRegenerate ? `<button class="ts-menu-item" data-act="regen"><i class="fa-solid fa-rotate"></i> ${t("답장 다시 받기")}</button>` : ''}
        ${message.inserted ? `<button class="ts-menu-item" data-act="uncommit"><i class="fa-solid fa-rotate-left"></i> ${t("여기부터 다시 반영")}</button>` : ''}
        <button class="ts-menu-item" data-act="truncate"><i class="fa-solid fa-scissors"></i> ${t("여기부터 지우기")}</button>
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
            if (ok) toastr.success(t("복사했어요."), t("문자 씬"));
            else toastr.error(t("복사하지 못했어요."), t("문자 씬"));
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
            toastr.info(t("{count}통이 다시 반영 대상이 됐어요.", { count }), t("문자 씬"));
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
        const replaceFrom = session.messages.findIndex(m => m.id === messageId);
        await requestReply({ proactive: replaceFrom === 0, replaceFrom });
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
                <button class="ts-btn ts-btn-mini2" data-act="cancel">${t("취소")}</button>
                <button class="ts-btn ts-btn-mini2 ts-btn-primary" data-act="save">${t("저장")}</button>
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
        syncCommitButton();
        syncSendButton();
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
async function onCommit({ endScene = false } = {}) {
    if (isBusy()) return;
    const session = getSession(S.activeSessionId);
    if (!session) return;
    const owner = captureOwner(session, { view: true });
    if (endScene && S.sheetEl.querySelector('#ts-input')?.value.trim()) {
        toastr.info(t("작성 중인 문자를 먼저 보내거나 비워 주세요."), t("문자 씬"));
        return;
    }

    if (!hasPendingChanges(session)) {
        if (endScene) { await finishScene(session, owner); return; }
        if (typeof toastr !== 'undefined') {
            toastr.info(t("아직 새로 주고받은 문자가 없어요."), t("문자 씬"));
        }
        return;
    }

    const done = await openCommitDialog(session);
    if (done && owner()) {
        if (endScene && !hasPendingChanges(session)) { await finishScene(session, owner); return; }
        rerender();
        syncCommitButton();
    }
}

async function finishScene(session, owner) {
    S.isCommitting = true;
    setBusy(true);
    const before = { closed: session.closed, endedAt: session.endedAt };
    closeSession(session.id);
    try {
        await persistChat(owner);
        if (owner()) closeSheet();
    } catch (error) {
        Object.assign(session, before);
        if (owner()) { saveSessions(); toastr.error(String(error?.message || error), t("문자 씬")); }
    } finally {
        S.isCommitting = false;
        if (owner()) setBusy(false);
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
    const session = getSession(S.activeSessionId);
    const canRetry = !session?.bundleMode && !input.value.trim()
        && !!last && (last.who === WHO.USER || last.kind)
        && !S.isGenerating && !S.isRevealing;

    button.classList.toggle('ts-send-retry', canRetry);
    icon.className = canRetry ? 'fa-solid fa-rotate' : 'fa-solid fa-paper-plane';
    button.title = canRetry ? t("답장 받기") : t("보내기");
    const request = overlay.querySelector('#ts-request');
    if (request) request.disabled = isBusy() || !messages.length;
}

async function onSendButton() {
    const input = S.sheetEl?.querySelector('#ts-input');
    if (input && !input.value.trim()) {
        const messages = getSession(S.activeSessionId)?.messages ?? [];
        const last = messages[messages.length - 1];
        if (!getSession(S.activeSessionId)?.bundleMode && last && (last.who === WHO.USER || last.kind)) {
            await requestReply({});
        }
        return;
    }
    await onSend();
}

export function syncCommitButton() {
    const btn = S.sheetEl?.querySelector('#ts-commit');
    if (!btn) return;
    const session = getSession(S.activeSessionId);
    if (!session) return;
    const batch = getCommitBatch(session);
    btn.disabled = isBusy() || !hasPendingChanges(session);
    btn.textContent = batch.replacement ? t("반영 수정") : batch.messages.length ? `${t("반영")} ${batch.messages.length}` : t("반영");
}
