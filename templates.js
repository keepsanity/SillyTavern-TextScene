// Static HTML fragments. No logic here.

import { INSERT_MODE, INSERT_MODE_LABELS, LANG, LANG_LABELS } from './constants.js';
import { THEMES } from './themes.js';

/** Wand-menu entry point. */
export function buildWandButtonHTML() {
    return `
    <div id="ts-wand-open" class="list-group-item flex-container flexGap5 interactable" tabindex="0">
        <div class="fa-solid fa-comment-sms extensionsMenuExtensionButton"></div>
        <span>문자 씬</span>
    </div>`;
}

/** Theme picker cards, previewed with the real theme colors from themes.js. */
function buildThemeCards() {
    return Object.entries(THEMES).map(([key, theme]) => {
        const v = theme.vars;
        // `default` has no vars, so preview it with the ST theme colors.
        const log = v['--ts-log-bg'] || v['--ts-sheet-bg'] || 'var(--SmartThemeBlurTintColor, #1b1b1b)';
        const mine = v['--ts-mine-bg'] || 'var(--SmartThemeQuoteColor, #4a7dbd)';
        const theirs = v['--ts-theirs-bg'] || 'var(--SmartThemeUserMesBlurTintColor, rgba(255,255,255,0.1))';
        const border = v['--ts-theirs-border'] || 'var(--SmartThemeBorderColor, #444)';
        return `
        <button type="button" class="ts-theme-card" data-theme="${key}">
            <span class="ts-theme-preview" style="background:${log}">
                <span class="ts-theme-bubble ts-theme-theirs" style="background:${theirs};border-color:${border}"></span>
                <span class="ts-theme-bubble ts-theme-mine" style="background:${mine}"></span>
            </span>
            <span class="ts-theme-name">${theme.name}</span>
        </button>`;
    }).join('');
}

/** Extension settings panel. */
export function buildSettingsHTML() {
    return `
    <div class="text-scene-settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>문자 씬 (Text Scene)</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">

                <hr>

                <label>말풍선 테마</label>
                <div class="ts-theme-grid" id="ts-theme-grid">${buildThemeCards()}</div>
                <hr>

                <label for="ts-profile">연결 프로필</label>
                <select id="ts-profile" class="text_pole"></select>

                <label for="ts-max-tokens">답장 최대 토큰</label>
                <input id="ts-max-tokens" class="text_pole" type="number" min="200" max="20000" step="500">

                <label for="ts-bridge-turns">상황 연결 (메인 채팅 최근 N턴)</label>
                <input id="ts-bridge-turns" class="text_pole" type="number" min="0" max="20" step="1">

                <label class="checkbox_label" for="ts-typing-effect">
                    <input id="ts-typing-effect" type="checkbox">
                    <span>답장을 여러 버블로 나눠서 천천히 받기</span>
                </label>

                <label for="ts-default-mode">종료할 때 기본 형식</label>
                <select id="ts-default-mode" class="text_pole">
                    ${Object.values(INSERT_MODE).map(v =>
                        `<option value="${v}">${INSERT_MODE_LABELS[v]}</option>`).join('')}
                </select>

                <label for="ts-insert-lang">메인 채팅에 넣을 때 언어</label>
                <select id="ts-insert-lang" class="text_pole">
                    ${Object.values(LANG).map(v =>
                        `<option value="${v}">${LANG_LABELS[v]}</option>`).join('')}
                </select>

                <hr>

                <label class="checkbox_label" for="ts-infoblock-time">
                    <input id="ts-infoblock-time" type="checkbox">
                    <span>인포블록에서 장면 시각 읽기</span>
                </label>

                <label class="checkbox_label" for="ts-auto-gap">
                    <input id="ts-auto-gap" type="checkbox">
                    <span>문자 씬을 열 때 "직전 장면에서 얼마나 지났는지" AI 에게 묻기</span>
                </label>

                <label class="checkbox_label" for="ts-catchup">
                    <input id="ts-catchup" type="checkbox">
                    <span>문자 창을 열 때 "그 사이 연락이 와 있었나" 확인하기</span>
                </label>

                <label class="checkbox_label" for="ts-insert-time">
                    <input id="ts-insert-time" type="checkbox">
                    <span>메인 채팅에 넣을 때 머리말에 시각 붙이기</span>
                </label>

                <label for="ts-time-regex">시각 추출 정규식</label>
                <input id="ts-time-regex" class="text_pole" type="text">

                <label for="ts-date-regex">날짜 추출 정규식</label>
                <input id="ts-date-regex" class="text_pole" type="text">

                <hr>

                <div class="inline-drawer">
                    <div class="inline-drawer-toggle inline-drawer-header">
                        <b>프롬프트 편집</b>
                        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                    </div>
                    <div class="inline-drawer-content">
                        <label for="ts-messenger-prompt">메신저 지시문</label>
                        <textarea id="ts-messenger-prompt" class="text_pole textarea_compact" rows="10"></textarea>

                        <label for="ts-summary-prompt">요약 지시문</label>
                        <small class="ts-note"><code>{{log}}</code> 자리에 문자 내용이 들어갑니다.</small>
                        <textarea id="ts-summary-prompt" class="text_pole textarea_compact" rows="10"></textarea>

                        <div class="ts-settings-actions">
                            <button id="ts-reset-prompts" class="menu_button">
                                <i class="fa-solid fa-rotate-left"></i> 프롬프트 기본값으로
                            </button>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    </div>`;
}
