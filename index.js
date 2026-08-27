/** SillyTavern - Text Scene. Entry point; init only. */

import { eventSource, event_types } from '../../../../script.js';
import { DEBUG_PREFIX } from './constants.js';
import { ensureSettings } from './config.js';
import { S } from './state.js';
import { buildSettingsHTML, buildWandButtonHTML } from './templates.js';
import { bindSettingsEvents } from './settingsPanel.js';
import { registerSlashCommands } from './slashCommands.js';
import { openSheet, closeSheet } from './ui/sheet.js';

(function init() {
    ensureSettings();

    // Extension settings panel
    const settingsContainer = document.getElementById('extensions_settings2')
        || document.getElementById('extensions_settings');
    if (settingsContainer) {
        settingsContainer.insertAdjacentHTML('beforeend', buildSettingsHTML());
        try {
            bindSettingsEvents();
        } catch (error) {
            console.error(DEBUG_PREFIX, 'Failed to bind settings:', error);
        }
    }

    // Wand menu button
    const wandMenu = document.getElementById('extensionsMenu');
    if (wandMenu) {
        wandMenu.insertAdjacentHTML('beforeend', buildWandButtonHTML());
        document.getElementById('ts-wand-open')?.addEventListener('click', () => {
            wandMenu.style.display = 'none';
            openSheet({ proactive: false });
        });
    }

    // Disabled: the history button distorts the ST message layout.
    // try { setupHistoryButtons(); } catch (error) { console.error(DEBUG_PREFIX, error); }

    // Sessions live in chat_metadata, so an open sheet must close on chat change or it
    // would write the previous chat's texts into the new chat's metadata.
    eventSource.on(event_types.CHAT_CHANGED, () => {
        if (S.isOpen) closeSheet();
        S.activeSessionId = null;
    });

    try {
        registerSlashCommands();
    } catch (error) {
        console.error(DEBUG_PREFIX, 'Failed to register slash commands:', error);
    }

    console.log(DEBUG_PREFIX, 'Text Scene loaded successfully.');
})();
