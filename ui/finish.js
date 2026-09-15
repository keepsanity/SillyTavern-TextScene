import { t } from '../i18n.js';

/** Commit popup — picks the format for handing pending messages to the main chat. */

import { INSERT_MODE, INSERT_MODE_LABELS, DEBUG_PREFIX } from '../constants.js';
import { S } from '../state.js';
import { getDefaultInsertMode } from '../config.js';
import { generateSummary, abortGeneration } from '../generation.js';
import { getPendingMessages } from '../store.js';
import { getCommitBatch } from '../commits.js';
import { captureOwner } from '../lifecycle.js';
import { insertIntoChat } from '../insert.js';
import { escapeHtml, bindOverlayHeight } from '../utils.js';

/**
 * Opens the popup. Resolves true once inserted, false on cancel.
 * @returns {Promise<boolean>}
 */
export function openCommitDialog(session) {
    return new Promise((resolve) => {
        const owner = captureOwner(session, { view: true });
        const batch = getCommitBatch(session);
        let mode = batch.commit?.mode || getDefaultInsertMode();
        // Fixed for as long as the popup is open.
        const pending = structuredClone(getPendingMessages(session));

        const overlay = document.createElement('div');
        overlay.className = 'ts-finish-overlay';
        overlay.innerHTML = `
        <div class="ts-finish-box">
            <div class="ts-finish-head">
                <i class="fa-solid fa-share-from-square"></i>
                ${t("RP 에 반영")}
                <span class="ts-finish-count">${batch.replacement ? t("기존 반영 수정") : t("새 문자")} ${pending.length}${t("통")}</span>
            </div>
            ${batch.replacement ? `<p class="ts-finish-hint">${t("기존 RP 블록을 이 내용으로 갱신합니다. 이후 진행된 RP까지 자동으로 고치지는 않습니다. 이전 반영 내용은 기록에 보존됩니다.")}</p>` : ''}

            <div class="ts-finish-modes" id="ts-modes">
                ${Object.values(INSERT_MODE).map(value => `
                    <button class="ts-mode${value === mode ? ' active' : ''}" data-mode="${value}">
                        ${escapeHtml(INSERT_MODE_LABELS[value])}
                    </button>`).join('')}
            </div>
            <div class="ts-finish-hint" id="ts-hint"></div>

            <div class="ts-finish-summary" id="ts-summary-wrap">
                <label class="ts-finish-label">
                    ${t("요약")}
                    <button class="ts-btn ts-btn-mini" id="ts-resummarize" title="${t("요약 다시 뽑기")}">
                        <i class="fa-solid fa-rotate"></i> ${t("다시")}
                    </button>
                </label>
                <textarea id="ts-summary" class="ts-summary-input" rows="4"
                          placeholder="${t("요약을 만드는 중...")}"></textarea>
            </div>

            <div class="ts-finish-foot">
                <div class="ts-finish-foot-right">
                    <button class="ts-btn" id="ts-cancel">${t("취소")}</button>
                    <button class="ts-btn ts-btn-primary" id="ts-insert">
                        <i class="fa-solid fa-check"></i> ${batch.replacement ? t("기존 반영 갱신") : t("넣기")}
                    </button>
                </div>
            </div>
        </div>`;
        document.body.appendChild(overlay);
        // Mobile address-bar correction — without it the footer is pushed off-screen.
        const releaseHeight = bindOverlayHeight(overlay);

        const summaryInput = overlay.querySelector('#ts-summary');
        const summaryWrap = overlay.querySelector('#ts-summary-wrap');
        const insertBtn = overlay.querySelector('#ts-insert');
        const hint = overlay.querySelector('#ts-hint');

        const HINTS = {
            [INSERT_MODE.SUMMARY]: t("요약만 들어갑니다. 원문은 문자 창에 남습니다."),
            [INSERT_MODE.BOTH]: t("요약과 전문이 함께 들어갑니다. 접혀 있어도 이후 대화는 전문을 읽습니다."),
            [INSERT_MODE.FULL]: t("전문만 들어갑니다."),
        };

        const syncMode = () => {
            overlay.querySelectorAll('.ts-mode').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.mode === mode);
            });
            summaryWrap.style.display = mode === INSERT_MODE.FULL ? 'none' : '';
            hint.textContent = HINTS[mode] ?? '';
        };
        syncMode();

        let summaryRun = 0;
        let running = false;
        const runSummary = async () => {
            if (running || S.isCommitting || !owner()) return;
            running = true;
            const run = ++summaryRun;
            summaryInput.value = '';
            summaryInput.placeholder = t("요약을 만드는 중...");
            summaryInput.disabled = true;
            insertBtn.disabled = true;
            overlay.querySelector('#ts-resummarize').disabled = true;
            try {
                const text = await generateSummary(session, pending);
                // Discard the result of a superseded run.
                if (run !== summaryRun || !owner()) return;
                summaryInput.value = text;
            } catch (error) {
                if (run !== summaryRun || !owner()) return;
                console.error(DEBUG_PREFIX, 'summary failed:', error);
                summaryInput.placeholder = t("요약을 만들지 못했어요.");
            } finally {
                if (run === summaryRun) {
                    running = false;
                    summaryInput.disabled = false;
                    insertBtn.disabled = false;
                    overlay.querySelector('#ts-resummarize').disabled = false;
                }
            }
        };

        if (mode !== INSERT_MODE.FULL && pending.length) runSummary();

        overlay.querySelector('#ts-resummarize').addEventListener('click', () => runSummary());

        overlay.querySelector('#ts-modes').addEventListener('click', (event) => {
            const btn = event.target.closest('.ts-mode');
            if (!btn) return;
            if (S.isCommitting) return;
            mode = btn.dataset.mode;
            if (mode === INSERT_MODE.FULL && running) {
                summaryRun++;
                running = false;
                abortGeneration();
                summaryInput.disabled = false;
                insertBtn.disabled = false;
                overlay.querySelector('#ts-resummarize').disabled = false;
            }
            syncMode();
            if (mode !== INSERT_MODE.FULL && pending.length && !summaryInput.value.trim() && !running) {
                runSummary();
            }
        });

        let settled = false;
        const finish = (result) => {
            if (settled) return;
            settled = true;
            summaryRun++;             // Ignore any in-flight summary result
            if (S.isSummarizing) abortGeneration();
            S.dialogs.delete(cancel);
            releaseHeight();
            document.removeEventListener('keydown', onKey, true);
            overlay.remove();
            resolve(result);
        };
        const onKey = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                finish(false);
            }
        };
        document.addEventListener('keydown', onKey, true);
        const cancel = () => finish(false);
        S.dialogs.add(cancel);

        overlay.querySelector('#ts-cancel').addEventListener('click', () => finish(false));

        overlay.querySelector('#ts-insert').addEventListener('click', async () => {
            if (settled || !owner() || S.isCommitting || running) return;
            const summary = summaryInput.value.trim();
            if (pending.length && mode !== INSERT_MODE.FULL && !summary) {
                if (typeof toastr !== 'undefined') {
                    toastr.warning(t("요약이 비어 있어요."), t("문자 씬"));
                }
                return;
            }

            insertBtn.disabled = true;
            const ok = await insertIntoChat(session, mode, summary, pending);
            if (settled || !owner()) return;
            if (!ok) {
                insertBtn.disabled = false;
                return;
            }
            if (typeof toastr !== 'undefined') {
                toastr.success(t("문자 {count}통을 RP 에 넘겼어요.", { count: pending.length }), t("문자 씬"));
            }
            finish(true);
        });
    });
}
