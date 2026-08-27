// Bubble themes: CSS variable sets applied inline to the sheet root.
// `default` defines nothing, so style.css falls back to ST theme colors.

export const THEME_VARS = [
    '--ts-sheet-bg',
    '--ts-head-bg',
    '--ts-log-bg',
    '--ts-fg',
    '--ts-border',
    '--ts-mine-bg',
    '--ts-mine-fg',
    '--ts-theirs-bg',
    '--ts-theirs-fg',
    '--ts-theirs-border',
    '--ts-meta-fg',
    '--ts-compose-bg',
    '--ts-send-bg',
];

export const THEMES = {
    default: {
        name: 'SillyTavern 테마',
        vars: {},
    },

    sky: {
        name: '하늘 · 노랑',
        vars: {
            '--ts-sheet-bg': '#9bbbd4',
            '--ts-head-bg': '#8faec8',
            '--ts-log-bg': '#9bbbd4',
            '--ts-fg': '#1a1a1a',
            '--ts-border': 'rgba(0,0,0,0.12)',
            '--ts-mine-bg': '#fee500',
            '--ts-mine-fg': '#1a1a1a',
            '--ts-theirs-bg': '#ffffff',
            '--ts-theirs-fg': '#1a1a1a',
            '--ts-theirs-border': 'transparent',
            '--ts-meta-fg': 'rgba(0,0,0,0.45)',
            '--ts-compose-bg': '#ffffff',
            '--ts-send-bg': '#fee500',
        },
    },

    bubble: {
        name: '파랑 · 회색',
        vars: {
            '--ts-sheet-bg': '#ffffff',
            '--ts-head-bg': 'rgba(249,249,249,0.94)',
            '--ts-log-bg': '#ffffff',
            '--ts-fg': '#000000',
            '--ts-border': 'rgba(0,0,0,0.1)',
            '--ts-mine-bg': '#248bf5',
            '--ts-mine-fg': '#ffffff',
            '--ts-theirs-bg': '#e9e9eb',
            '--ts-theirs-fg': '#000000',
            '--ts-theirs-border': 'transparent',
            '--ts-meta-fg': 'rgba(0,0,0,0.4)',
            '--ts-compose-bg': '#ffffff',
            '--ts-send-bg': '#248bf5',
        },
    },

    paper: {
        name: '종이 · 연두',
        vars: {
            '--ts-sheet-bg': '#ece5dd',
            '--ts-head-bg': '#075e54',
            '--ts-log-bg': '#ece5dd',
            '--ts-fg': '#111b21',
            '--ts-border': 'rgba(0,0,0,0.1)',
            '--ts-mine-bg': '#dcf8c6',
            '--ts-mine-fg': '#111b21',
            '--ts-theirs-bg': '#ffffff',
            '--ts-theirs-fg': '#111b21',
            '--ts-theirs-border': 'transparent',
            '--ts-meta-fg': 'rgba(0,0,0,0.45)',
            '--ts-compose-bg': '#ffffff',
            '--ts-send-bg': '#25d366',
        },
    },

    forest: {
        name: '초록',
        vars: {
            '--ts-sheet-bg': '#ffffff',
            '--ts-head-bg': '#ffffff',
            '--ts-log-bg': '#f7f8fa',
            '--ts-fg': '#111111',
            '--ts-border': 'rgba(0,0,0,0.08)',
            '--ts-mine-bg': '#06c755',
            '--ts-mine-fg': '#ffffff',
            '--ts-theirs-bg': '#ffffff',
            '--ts-theirs-fg': '#111111',
            '--ts-theirs-border': 'rgba(0,0,0,0.08)',
            '--ts-meta-fg': 'rgba(0,0,0,0.4)',
            '--ts-compose-bg': '#ffffff',
            '--ts-send-bg': '#06c755',
        },
    },

    midnight: {
        name: '심야',
        vars: {
            '--ts-sheet-bg': '#17212b',
            '--ts-head-bg': '#17212b',
            '--ts-log-bg': '#0e1621',
            '--ts-fg': '#e9edf0',
            '--ts-border': 'rgba(255,255,255,0.08)',
            '--ts-mine-bg': '#2b5278',
            '--ts-mine-fg': '#ffffff',
            '--ts-theirs-bg': '#182533',
            '--ts-theirs-fg': '#e9edf0',
            '--ts-theirs-border': 'rgba(255,255,255,0.06)',
            '--ts-meta-fg': 'rgba(255,255,255,0.38)',
            '--ts-compose-bg': '#17212b',
            '--ts-send-bg': '#5288c1',
        },
    },

    dusk: {
        name: '보랏빛',
        vars: {
            '--ts-sheet-bg': '#241b2f',
            '--ts-head-bg': '#2c2139',
            '--ts-log-bg': '#1c1526',
            '--ts-fg': '#efe8f5',
            '--ts-border': 'rgba(255,255,255,0.08)',
            '--ts-mine-bg': '#8b5cf6',
            '--ts-mine-fg': '#ffffff',
            '--ts-theirs-bg': '#2f2440',
            '--ts-theirs-fg': '#efe8f5',
            '--ts-theirs-border': 'rgba(255,255,255,0.06)',
            '--ts-meta-fg': 'rgba(255,255,255,0.4)',
            '--ts-compose-bg': '#2c2139',
            '--ts-send-bg': '#8b5cf6',
        },
    },

    mono: {
        name: '흑백',
        vars: {
            '--ts-sheet-bg': '#fafafa',
            '--ts-head-bg': '#fafafa',
            '--ts-log-bg': '#fafafa',
            '--ts-fg': '#141414',
            '--ts-border': 'rgba(0,0,0,0.12)',
            '--ts-mine-bg': '#141414',
            '--ts-mine-fg': '#fafafa',
            '--ts-theirs-bg': '#ffffff',
            '--ts-theirs-fg': '#141414',
            '--ts-theirs-border': 'rgba(0,0,0,0.14)',
            '--ts-meta-fg': 'rgba(0,0,0,0.4)',
            '--ts-compose-bg': '#ffffff',
            '--ts-send-bg': '#141414',
        },
    },
};

export const DEFAULT_THEME = 'default';

export function getTheme(key) {
    return THEMES[key] ?? THEMES[DEFAULT_THEME];
}

/** Sets this theme's variables and removes the ones it doesn't define, so no prior theme lingers. */
export function applyTheme(el, key) {
    if (!el) return;
    const { vars } = getTheme(key);
    for (const name of THEME_VARS) {
        if (vars[name]) el.style.setProperty(name, vars[name]);
        else el.style.removeProperty(name);
    }
}
