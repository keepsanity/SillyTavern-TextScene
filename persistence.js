import { t } from './i18n.js';

/** Confirm the response from the same save endpoint used by SillyTavern. Never force integrity. */
import { chat, chat_metadata, getRequestHeaders, cancelDebouncedChatSave, isChatSaving } from '../../../../script.js';
import { getContext } from '../../../extensions.js';
import { ensureCurrent } from './lifecycle.js';

export async function persistChat(owner) {
    const deadline = Date.now() + 10000;
    while (isChatSaving && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 100));
        ensureCurrent(owner);
    }
    if (isChatSaving) throw new Error(t("다른 채팅 저장이 끝나지 않았어요. 잠시 후 다시 시도해 주세요."));
    ensureCurrent(owner);
    const ctx = getContext();
    const character = ctx.characters?.[ctx.characterId];
    if (ctx.groupId || !ctx.chatId || !character?.avatar) throw new Error(t("저장할 캐릭터 채팅을 찾지 못했어요."));
    cancelDebouncedChatSave();
    const response = await fetch('/api/chats/save', {
        method: 'POST', headers: getRequestHeaders(), cache: 'no-cache',
        // All destination fields and the body are captured before the first network await.
        body: JSON.stringify({ ch_name: character.name, file_name: ctx.chatId, avatar_url: character.avatar,
            chat: [{ chat_metadata, user_name: 'unused', character_name: 'unused' }, ...chat], force: false }),
    });
    if (!response.ok) throw new Error(t("채팅 저장 실패 ({status}). 같은 반영을 다시 시도할 수 있어요.", { status: response.status }));
}
