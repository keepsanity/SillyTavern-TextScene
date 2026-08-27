/** Time-shift adjustment popup: how long after the previous scene the text scene starts. */

import { setTimeShift, getTimeShift, getSession } from '../store.js';
import { estimateElapsedMinutes } from '../generation.js';
import { escapeHtml, bindOverlayHeight } from '../utils.js';

/** Quick adjust steps, in minutes. */
const QUICK_STEPS = [10, 30, 60, 120];

export function formatDuration(minutes) {
    const m = Math.max(0, Math.round(minutes));
    if (m === 0) return '바로 이어서';
    const hours = Math.floor(m / 60);
    const mins = m % 60;
    if (!hours) return `${mins}분 뒤`;
    if (!mins) return `${hours}시간 뒤`;
    return `${hours}시간 ${mins}분 뒤`;
}

/**
 * Opens the popup. Resolves true when the value changed.
 * @returns {Promise<boolean>}
 */
export function openTimeAdjust(sessionId) {
    return new Promise((resolve) => {
        const session = getSession(sessionId);
        if (!session) return resolve(false);

        const startClock = session.messages.find(m => m.clock)?.clock || '';
        let shift = getTimeShift(session);
        let changed = false;

        const overlay = document.createElement('div');
        overlay.className = 'ts-finish-overlay';
        overlay.innerHTML = `
        <div class="ts-finish-box ts-time-box">
            <div class="ts-finish-head">
                <i class="fa-solid fa-clock"></i>
                문자 시각
            </div>

            <div class="ts-time-current">
                <div class="ts-time-clock" id="ts-time-clock">${escapeHtml(startClock || '—')}</div>
                <div class="ts-time-gap" id="ts-time-gap">${escapeHtml(formatDuration(shift))}</div>
            </div>
            <div class="ts-finish-hint">
                직전 장면에서 얼마나 지난 뒤에 문자하는지입니다.
            </div>

            <div class="ts-time-steps" id="ts-time-steps">
                <button class="ts-btn ts-btn-mini2" data-step="-10">−10분</button>
                ${QUICK_STEPS.map(v => `<button class="ts-btn ts-btn-mini2" data-step="${v}">+${v >= 60 ? (v / 60) + '시간' : v + '분'}</button>`).join('')}
            </div>

            <label for="ts-time-input" class="ts-finish-label">직접 입력 (분)</label>
            <input id="ts-time-input" class="text_pole ts-time-input" type="number" min="0" max="720" step="5" value="${shift}">

            <div class="ts-finish-foot">
                <button class="ts-btn" id="ts-time-ask">
                    <i class="fa-solid fa-wand-magic-sparkles"></i> AI 에게 맡기기
                </button>
                <div class="ts-finish-foot-right">
                    <button class="ts-btn ts-btn-primary" id="ts-time-done">확인</button>
                </div>
            </div>
        </div>`;
        document.body.appendChild(overlay);
        const releaseHeight = bindOverlayHeight(overlay);

        const clockEl = overlay.querySelector('#ts-time-clock');
        const gapEl = overlay.querySelector('#ts-time-gap');
        const input = overlay.querySelector('#ts-time-input');
        const askBtn = overlay.querySelector('#ts-time-ask');

        const apply = (next) => {
            shift = Math.min(720, Math.max(0, Math.round(next)));
            setTimeShift(sessionId, shift);
            changed = true;
            input.value = shift;
            gapEl.textContent = formatDuration(shift);
            const fresh = getSession(sessionId);
            clockEl.textContent = fresh?.messages.find(m => m.clock)?.clock || '—';
        };

        overlay.querySelector('#ts-time-steps').addEventListener('click', (event) => {
            const step = event.target.closest('[data-step]')?.dataset.step;
            if (step === undefined) return;
            apply(shift + Number(step));
        });

        input.addEventListener('change', () => apply(Number(input.value)));

        askBtn.addEventListener('click', async () => {
            askBtn.disabled = true;
            const original = askBtn.innerHTML;
            askBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 물어보는 중...';
            try {
                const minutes = await estimateElapsedMinutes();
                if (minutes === null) {
                    if (typeof toastr !== 'undefined') {
                        toastr.warning('장면을 읽고 판단하지 못했어요.', '문자 씬');
                    }
                } else {
                    apply(minutes);
                }
            } finally {
                askBtn.disabled = false;
                askBtn.innerHTML = original;
            }
        });

        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            releaseHeight();
            document.removeEventListener('keydown', onKey, true);
            overlay.remove();
            resolve(changed);
        };
        const onKey = (event) => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(); }
        };
        document.addEventListener('keydown', onKey, true);

        overlay.querySelector('#ts-time-done').addEventListener('click', finish);
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) finish();
        });
    });
}

/** Asks the model for the time shift once per session, unless one is already fixed. */
export async function autoEstimateTimeShift(sessionId) {
    const session = getSession(sessionId);
    if (!session) return false;
    // 0 is a valid shift, so test against null.
    if (session.timeShift != null) return false;
    // Any timestamped message means the scene's baseline is already set.
    if (session.messages.some(m => m.clock)) return false;

    const minutes = await estimateElapsedMinutes();
    // Record nothing on failure so the next open can retry.
    if (minutes === null) return false;
    setTimeShift(sessionId, minutes);
    return true;
}
