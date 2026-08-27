/** Settings panel bindings. */

import { saveSettingsDebounced } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import { ConnectionManagerRequestService } from '../../../extensions/shared.js';
import {
    EXTENSION_NAME,
    DEBUG_PREFIX,
    MESSENGER_SYSTEM,
    SUMMARY_PROMPT,
} from './constants.js';
import { ensureSettings, getDefaultInsertMode, getInsertLanguage, getThemeKey } from './config.js';
import { applyTheme } from './themes.js';
import { S } from './state.js';

function bindInput(selector, key, { type = 'text', onChange = null } = {}) {
    const el = document.querySelector(selector);
    if (!el) {
        console.warn(DEBUG_PREFIX, `settings element not found: ${selector}`);
        return;
    }
    const settings = ensureSettings();

    if (type === 'checkbox') {
        el.checked = !!settings[key];
    } else {
        el.value = settings[key] ?? '';
    }

    const event = (type === 'checkbox' || el.tagName === 'SELECT') ? 'change' : 'input';
    el.addEventListener(event, () => {
        const s = ensureSettings();
        if (type === 'checkbox') {
            s[key] = el.checked;
        } else if (type === 'number') {
            const v = Number(el.value);
            // config.js clamps the range on read; keep an invalid entry out of settings.
            s[key] = Number.isFinite(v) ? v : s[key];
        } else {
            s[key] = el.value;
        }
        saveSettingsDebounced();
        onChange?.();
    });
}

export function bindSettingsEvents() {
    ensureSettings();

    bindInput('#ts-max-tokens', 'maxTokens', { type: 'number' });
    bindInput('#ts-bridge-turns', 'bridgeTurns', { type: 'number' });
    bindInput('#ts-typing-effect', 'typingEffect', { type: 'checkbox' });
    bindInput('#ts-infoblock-time', 'infoblockTime', { type: 'checkbox' });
    bindInput('#ts-auto-gap', 'autoEstimateGap', { type: 'checkbox' });
    bindInput('#ts-catchup', 'catchup', { type: 'checkbox' });
    bindInput('#ts-insert-time', 'insertTime', { type: 'checkbox' });
    bindInput('#ts-time-regex', 'timeRegex');
    bindInput('#ts-date-regex', 'dateRegex');
    bindInput('#ts-messenger-prompt', 'messengerPrompt');
    bindInput('#ts-summary-prompt', 'summaryPrompt');

    const modeSelect = document.querySelector('#ts-default-mode');
    if (modeSelect) {
        modeSelect.value = getDefaultInsertMode();
        modeSelect.addEventListener('change', () => {
            ensureSettings().defaultInsertMode = modeSelect.value;
            saveSettingsDebounced();
        });
    }

    const langSelect = document.querySelector('#ts-insert-lang');
    if (langSelect) {
        langSelect.value = getInsertLanguage();
        langSelect.addEventListener('change', () => {
            ensureSettings().insertLanguage = langSelect.value;
            saveSettingsDebounced();
        });
    }

    bindThemePicker();
    bindProfileDropdown();

    document.querySelector('#ts-reset-prompts')?.addEventListener('click', () => {
        if (!confirm('메신저 지시문과 요약 지시문을 기본값으로 되돌릴까요?')) return;
        const s = ensureSettings();
        s.messengerPrompt = MESSENGER_SYSTEM;
        s.summaryPrompt = SUMMARY_PROMPT;
        saveSettingsDebounced();
        const m = document.querySelector('#ts-messenger-prompt');
        const u = document.querySelector('#ts-summary-prompt');
        if (m) m.value = MESSENGER_SYSTEM;
        if (u) u.value = SUMMARY_PROMPT;
        if (typeof toastr !== 'undefined') toastr.info('기본값으로 되돌렸어요.', '문자 씬');
    });
}

// handleDropdown throws when the Connection Manager is disabled; an empty profile falls back to generateRaw.
function bindProfileDropdown() {
    const select = document.querySelector('#ts-profile');
    if (!select) return;

    try {
        ConnectionManagerRequestService.handleDropdown(
            '#ts-profile',
            ensureSettings().profileId,
            (profile) => {
                ensureSettings().profileId = profile?.id ?? '';
                saveSettingsDebounced();
            },
        );
    } catch (error) {
        console.warn(DEBUG_PREFIX, 'Connection Manager unavailable:', error);
        select.innerHTML = '<option value="">— 연결 관리자를 켜면 고를 수 있어요 —</option>';
        select.disabled = true;
        if (extension_settings[EXTENSION_NAME]?.profileId) {
            extension_settings[EXTENSION_NAME].profileId = '';
            saveSettingsDebounced();
        }
    }
}

function bindThemePicker() {
    const grid = document.querySelector('#ts-theme-grid');
    if (!grid) return;

    const syncActive = () => {
        const current = getThemeKey();
        grid.querySelectorAll('.ts-theme-card').forEach(card => {
            card.classList.toggle('active', card.dataset.theme === current);
        });
    };
    syncActive();

    grid.addEventListener('click', (event) => {
        const card = event.target.closest('.ts-theme-card');
        if (!card) return;
        ensureSettings().theme = card.dataset.theme;
        saveSettingsDebounced();
        syncActive();
        applyTheme(S.sheetEl?.querySelector('.ts-sheet'), card.dataset.theme);
    });
}
