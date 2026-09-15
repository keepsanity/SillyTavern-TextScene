import { t } from './i18n.js';

/** Bind asynchronous work to the actual loaded chat, not a reusable session ID. */
import { getContext } from '../../../extensions.js';
import { META_KEY } from './constants.js';
import { S } from './state.js';

export function captureOwner(session = null, { view = false } = {}) {
    const ctx = getContext();
    const metadata = ctx.chatMetadata;
    const chatId = ctx.chatId;
    const characterId = ctx.characterId;
    const epoch = S.viewEpoch;
    return () => {
        const current = getContext();
        return current.chatMetadata === metadata && current.chatId === chatId
            && current.characterId === characterId
            && (!session || metadata?.[META_KEY]?.sessions?.includes(session))
            && (!view || (S.isOpen && S.viewEpoch === epoch && S.activeSessionId === session?.id));
    };
}

export function cancelled() {
    return new DOMException(t("작업이 취소되었어요."), 'AbortError');
}

export function ensureCurrent(owner, signal) {
    if (signal?.aborted || !owner()) throw cancelled();
}

/** The core raw API cannot accept an external signal. Stop waiting and discard its result. */
export function withAbort(promise, signal) {
    if (signal.aborted) return Promise.reject(cancelled());
    return new Promise((resolve, reject) => {
        const abort = () => reject(cancelled());
        signal.addEventListener('abort', abort, { once: true });
        Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
}
