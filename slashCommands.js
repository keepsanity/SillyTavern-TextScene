/** Slash command `/text` — opens the text scene sheet. */

import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import {
    ARGUMENT_TYPE,
    SlashCommandNamedArgument,
} from '../../../slash-commands/SlashCommandArgument.js';
import { isTrueBoolean } from '../../../utils.js';
import { openSheet } from './ui/sheet.js';

export function registerSlashCommands() {
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'text',
        aliases: ['textscene'],
        helpString: `
            <div>
                문자 씬을 엽니다. [반영] 할 때 메시지 한 개만 메인 채팅에 들어갑니다.
            </div>
            <div>
                <code>first=true</code> 를 주면 열자마자 상대가 먼저 문자를 보냅니다.
            </div>
            <div><strong>예시:</strong></div>
            <ul>
                <li><pre><code class="language-stscript">/text</code></pre></li>
                <li><pre><code class="language-stscript">/text first=true</code></pre></li>
            </ul>
        `,
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'first',
                description: '상대가 먼저 문자를 보내며 시작',
                typeList: [ARGUMENT_TYPE.BOOLEAN],
                defaultValue: 'false',
                enumList: ['true', 'false'],
            }),
        ],
        callback: async (args) => {
            await openSheet({ proactive: isTrueBoolean(String(args?.first ?? 'false')) });
            return '';
        },
    }));
}
