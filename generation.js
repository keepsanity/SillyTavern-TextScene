/** Reply generation. Sends via a connection profile if set, otherwise the current API. */

import { generateRawData, extractMessageFromData } from '../../../../script.js';
import { ConnectionManagerRequestService } from '../../../extensions/shared.js';
import {
    DEBUG_PREFIX,
    REPLY_KIND,
    SUMMARY_MAX_TOKENS,
    TIME_ESTIMATE_MAX_TOKENS,
    TIME_ESTIMATE_MAX_MINUTES,
} from './constants.js';
import { getProfileId, getMaxTokens } from './config.js';
import { buildChatMessages, buildSummaryMessages, buildTimeEstimateMessages } from './prompt.js';
import { splitIntoBubbles, extractReplyMarker } from './utils.js';
import { S } from './state.js';

/** One-line user-facing explanation of an unusable response. */
function describeAttempt(raw) {
    const text = String(raw ?? '');
    const limit = getMaxTokens();
    if (!text.trim()) {
        return `모델이 빈 응답을 줬어요. 응답 상한은 ${limit} 토큰이에요.`;
    }
    return `응답은 ${text.length}자 왔는데 문자로 쓸 내용이 없었어요. `
        + `나레이션만 왔거나 상한(${limit} 토큰)에 걸려 잘렸을 수 있어요.`;
}

const SECRET_KEYS = ['proxy_password', 'api_key', 'secret_id', 'reverse_proxy'];

/**
 * Summarises a captured generation payload: every parameter verbatim, message bodies
 * shortened, secrets removed. This is what gets shown on the issue card.
 */
function summarizeRequest(body) {
    try {
        const data = JSON.parse(body);
        const messages = Array.isArray(data.messages) ? data.messages : [];
        const params = {};
        for (const [k, v] of Object.entries(data)) {
            if (k === 'messages') continue;
            params[k] = SECRET_KEYS.includes(k) ? '<removed>' : v;
        }
        const lines = messages.map((m, i) => {
            const text = String(m?.content ?? '');
            const head = text.length > 300 ? text.slice(0, 300) + ` …(+${text.length - 300})` : text;
            return `[${i}] ${m?.role}: ${head}`;
        });
        const br = String.fromCharCode(10);
        return JSON.stringify(params, null, 1) + br + br
            + '--- messages (' + messages.length + ') ---' + br + lines.join(br);
    } catch (error) {
        return String(body ?? '').slice(0, 4000);
    }
}

/** Records the payload ST posts to its own backend so an empty reply can be diagnosed. */
async function captureRequest(fn) {
    const original = globalThis.fetch;
    if (typeof original !== 'function') return fn();
    let captured = '';
    globalThis.fetch = function (input, init) {
        try {
            const url = typeof input === 'string' ? input : (input?.url ?? '');
            if (url.includes('chat-completions/generate') && init?.body) captured = String(init.body);
        } catch (error) {
            // Never let instrumentation break the request.
        }
        return original.apply(this, arguments);
    };
    try {
        return await fn();
    } finally {
        globalThis.fetch = original;
        S.lastRequest = captured ? summarizeRequest(captured) : '';
    }
}

/** sendRequest gives { content, reasoning } when extractData=true. */
function extractContent(result) {
    if (typeof result === 'string') return result;
    if (result && typeof result === 'object' && typeof result.content === 'string') {
        return result.content;
    }
    return '';
}

/**
 * Sends the assembled message array.
 * @param {Array<{role: string, content: string}>} messages
 * @returns {Promise<string>} raw model response text
 */
async function dispatch(messages, maxTokens, signal) {
    const profileId = getProfileId();

    if (profileId) {
        try {
            const result = await ConnectionManagerRequestService.sendRequest(
                profileId,
                messages,
                maxTokens,
                { stream: false, signal: signal ?? null, extractData: true },
                // No reasoning override: the profile's own settings are what the main chat
                // uses successfully, and diverging from them produced empty completions.
            );
            return extractContent(result);
        } catch (error) {
            // A missing or disabled profile falls back to the current API rather than failing.
            if (signal?.aborted) throw error;
            console.warn(DEBUG_PREFIX, 'Profile request failed, falling back to current API:', error);
            if (typeof toastr !== 'undefined') {
                toastr.warning('연결 프로필 호출에 실패해 현재 API 로 진행합니다.', '문자 씬');
            }
        }
    }

    // generateRawData, not generateRaw: cleanUpMessage strips stop-sequence strings from
    // the body, which would delete the bubble separator and run sentences together.
    const data = await generateRawData({
        prompt: messages,
        responseLength: maxTokens,
        instructOverride: true,
        quietToLoud: true,
    });
    return extractMessageFromData(data);
}

/**
 * Gets the character's next reply, with the reply delay the model chose on line 1.
 * @returns {Promise<{bubbles: string[], delayMinutes: number|null, kind: string}>} kind is a REPLY_KIND value
 */
export async function generateReply(session, { proactive = false, catchup = false } = {}) {
    const messages = buildChatMessages(session, { proactive, catchup });
    const controller = new AbortController();
    S.abortController = controller;
    S.isGenerating = true;
    try {
        const raw = await captureRequest(() => dispatch(messages, getMaxTokens(), controller.signal));
        const { kind, delayMinutes, text } = extractReplyMarker(raw);
        const bubbles = splitIntoBubbles(text);
        if (!bubbles.length && kind === REPLY_KIND.REPLY) {
            console.warn(DEBUG_PREFIX, 'empty reply. raw response was:', JSON.stringify(raw));
            S.lastIssue = {
                reason: '답장이 비어서 왔어요',
                detail: describeAttempt(raw),
                raw: String(raw ?? ''),
                request: S.lastRequest,
                at: Date.now(),
            };
        }
        return { bubbles, delayMinutes, kind };
    } catch (error) {
        if (!controller.signal.aborted) {
            S.lastIssue = {
                reason: '답장을 받지 못했어요',
                detail: String(error?.message || error),
                raw: '',
                at: Date.now(),
            };
        }
        throw error;
    } finally {
        S.isGenerating = false;
        if (S.abortController === controller) S.abortController = null;
    }
}

/** Summarizes the text log. Used as a draft in the close popup. */
export async function generateSummary(session, targets = null) {
    const messages = buildSummaryMessages(session, targets);
    const controller = new AbortController();
    S.abortController = controller;
    S.isSummarizing = true;
    try {
        const raw = await dispatch(messages, SUMMARY_MAX_TOKENS, controller.signal);
        return String(raw ?? '').trim();
    } finally {
        S.isSummarizing = false;
        if (S.abortController === controller) S.abortController = null;
    }
}

/**
 * Asks the model how many minutes passed between the previous scene and the text scene.
 * @returns {Promise<number|null>} elapsed minutes, or null if unavailable or untrusted
 */
export async function estimateElapsedMinutes() {
    const messages = buildTimeEstimateMessages();
    if (!messages) return null;

    const controller = new AbortController();
    S.abortController = controller;
    S.isEstimating = true;
    try {
        const raw = await dispatch(messages, TIME_ESTIMATE_MAX_TOKENS, controller.signal);
        // The model may wrap the number in filler, so take the first integer.
        const found = String(raw ?? '').match(/\d+/);
        if (!found) {
            console.warn(DEBUG_PREFIX, 'time estimate: no number in response:', JSON.stringify(raw));
            return null;
        }
        const minutes = Number(found[0]);
        if (!Number.isFinite(minutes) || minutes < 0) return null;
        if (minutes > TIME_ESTIMATE_MAX_MINUTES) {
            console.warn(DEBUG_PREFIX, `time estimate out of range (${minutes}m):`, JSON.stringify(raw));
            return null;
        }
        return minutes;
    } catch (error) {
        console.warn(DEBUG_PREFIX, 'time estimate failed:', error);
        return null;
    } finally {
        S.isEstimating = false;
        if (S.abortController === controller) S.abortController = null;
    }
}

/** Cancels the ongoing generation and flushes any remaining bubbles. */
export function abortGeneration() {
    S.skipReveal = true;
    try {
        S.abortController?.abort(new Error('Cancelled by user'));
    } catch (error) {
        console.error(DEBUG_PREFIX, error);
    }
}
