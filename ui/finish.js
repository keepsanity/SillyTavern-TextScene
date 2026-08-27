/** Commit popup — picks the format for handing pending messages to the main chat. */

import { INSERT_MODE, INSERT_MODE_LABELS, DEBUG_PREFIX } from '../constants.js';
import { S } from '../state.js';
import { getDefaultInsertMode } from '../config.js';
import { generateSummary, abortGeneration } from '../generation.js';
import { setSummary, markInserted, getPendingMessages } from '../store.js';
import { insertIntoChat } from '../insert.js';
import { escapeHtml, bindOverlayHeight } from '../utils.js';

/**
 * Opens the popup. Resolves true once inserted, false on cancel.
 * @returns {Promise<boolean>}
 */
export function openCommitDialog(session) {
    return new Promise((resolve) => {
        let mode = getDefaultInsertMode();
        // Fixed for as long as the popup is open.
        const pending = getPendingMessages(session);

        const overlay = document.createElement('div');
        overlay.className = 'ts-finish-overlay';
        overlay.innerHTML = `
        <div class="ts-finish-box">
            <div class="ts-finish-head">
                <i class="fa-solid fa-share-from-square"></i>
                RP 에 반영
                <span class="ts-finish-count">새 문자 ${pending.length}통</span>
            </div>

            <div class="ts-finish-modes" id="ts-modes">
                ${Object.values(INSERT_MODE).map(value => `
                    <button class="ts-mode${value === mode ? ' active' : ''}" data-mode="${value}">
                        ${escapeHtml(INSERT_MODE_LABELS[value])}
                    </button>`).join('')}
            </div>
            <div class="ts-finish-hint" id="ts-hint"></div>

            <div class="ts-finish-summary" id="ts-summary-wrap">
                <label class="ts-finish-label">
                    요약
                    <button class="ts-btn ts-btn-mini" id="ts-resummarize" title="요약 다시 뽑기">
                        <i class="fa-solid fa-rotate"></i> 다시
                    </button>
                </label>
                <textarea id="ts-summary" class="ts-summary-input" rows="4"
                          placeholder="요약을 만드는 중..."></textarea>
            </div>

            <div class="ts-finish-foot">
                <div class="ts-finish-foot-right">
                    <button class="ts-btn" id="ts-cancel">취소</button>
                    <button class="ts-btn ts-btn-primary" id="ts-insert">
                        <i class="fa-solid fa-check"></i> 넣기
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
            [INSERT_MODE.SUMMARY]: '요약만 들어갑니다. 원문은 문자 창에 남습니다.',
            [INSERT_MODE.BOTH]: '요약과 전문이 함께 들어갑니다. 접혀 있어도 이후 대화는 전문을 읽습니다.',
            [INSERT_MODE.FULL]: '전문만 들어갑니다.',
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
        const runSummary = async () => {
            const run = ++summaryRun;
            summaryInput.value = '';
            summaryInput.placeholder = '요약을 만드는 중...';
            summaryInput.disabled = true;
            insertBtn.disabled = true;
            try {
                const text = await generateSummary(session, pending);
                // Discard the result of a superseded run.
                if (run !== summaryRun) return;
                summaryInput.value = text;
            } catch (error) {
                if (run !== summaryRun) return;
                console.error(DEBUG_PREFIX, 'summary failed:', error);
                summaryInput.placeholder = '요약을 만들지 못했어요.';
            } finally {
                if (run === summaryRun) {
                    summaryInput.disabled = false;
                    insertBtn.disabled = false;
                }
            }
        };

        if (mode !== INSERT_MODE.FULL) runSummary();

        overlay.querySelector('#ts-resummarize').addEventListener('click', () => runSummary());

        overlay.querySelector('#ts-modes').addEventListener('click', (event) => {
            const btn = event.target.closest('.ts-mode');
            if (!btn) return;
            mode = btn.dataset.mode;
            syncMode();
            if (mode !== INSERT_MODE.FULL && !summaryInput.value.trim() && !S.isSummarizing) {
                runSummary();
            }
        });

        let settled = false;
        const finish = (result) => {
            if (settled) return;
            settled = true;
            summaryRun++;             // Ignore any in-flight summary result
            if (S.isSummarizing) abortGeneration();
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

        overlay.querySelector('#ts-cancel').addEventListener('click', () => finish(false));

        overlay.querySelector('#ts-insert').addEventListener('click', async () => {
            const summary = summaryInput.value.trim();
            if (mode !== INSERT_MODE.FULL && !summary) {
                if (typeof toastr !== 'undefined') {
                    toastr.warning('요약이 비어 있어요.', '문자 씬');
                }
                return;
            }

            insertBtn.disabled = true;
            setSummary(session.id, summary);
            const ok = await insertIntoChat(session, mode, summary, pending);
            if (!ok) {
                insertBtn.disabled = false;
                return;
            }
            markInserted(session.id, pending.map(m => m.id));
            if (typeof toastr !== 'undefined') {
                toastr.success(`문자 ${pending.length}통을 RP 에 넘겼어요.`, '문자 씬');
            }
            finish(true);
        });
    });
}
