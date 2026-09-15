import { t } from './i18n.js';

/** Independent requests with chat ownership, cancellation and no global fetch patching. */
import { generateRawData, extractMessageFromData } from '../../../../script.js';
import { ConnectionManagerRequestService } from '../../../extensions/shared.js';
import { DEBUG_PREFIX, REPLY_KIND } from './constants.js';
import { getProfileId, getMaxTokens, getSummaryMaxTokens, getTimeMaxTokens } from './config.js';
import { buildChatMessages, buildSummaryMessages, buildTimeEstimateMessages, buildSceneContextMessages } from './prompt.js';
import { parseReply } from './utils.js';
import { S } from './state.js';
import { captureOwner, ensureCurrent, withAbort, cancelled } from './lifecycle.js';

// The core temporarily changes global response-length settings. Never overlap raw requests.
let rawQueue = Promise.resolve();

function begin(flag, session) {
    const controller = new AbortController();
    const job = { controller, flag, owner: captureOwner(session), startedAt: Date.now() };
    S.jobs.add(job);
    S.abortController = controller;
    S[flag] = true;
    return job;
}

function end(job) {
    S.jobs.delete(job);
    S[job.flag] = [...S.jobs].some(j => j.flag === job.flag && !j.controller.signal.aborted);
    if (S.abortController === job.controller) S.abortController = null;
}

async function dispatch(messages, maxTokens, job) {
    const signal = job.controller.signal;
    ensureCurrent(job.owner, signal);
    const profileId = getProfileId();
    if (profileId) {
        // A profile error must not silently change the model/provider or duplicate the request.
        const result = await withAbort(ConnectionManagerRequestService.sendRequest(
            profileId, messages, maxTokens, { stream: false, signal, extractData: true },
        ), signal);
        ensureCurrent(job.owner, signal);
        return typeof result === 'string' ? result : String(result?.content ?? '');
    }
    const request = rawQueue.catch(() => {}).then(async () => {
        ensureCurrent(job.owner, signal);
        const data = await generateRawData({
            prompt: messages, responseLength: maxTokens, instructOverride: true, quietToLoud: true,
        });
        ensureCurrent(job.owner, signal);
        return extractMessageFromData(data);
    });
    rawQueue = request.catch(() => {});
    return withAbort(request, signal);
}

function requestDescription(messages, limit) {
    // Our own prompt only: never capture other extensions' requests or transport credentials.
    return JSON.stringify({ maxTokens: limit, route: getProfileId() ? t("연결 프로필") : t("현재 API"),
        messages: messages.map(m => ({ role: m.role, content: String(m.content).slice(0, 300) })) }, null, 2);
}

export async function generateReply(session, options = {}) {
    const job = begin('isGenerating', session);
    const limit = getMaxTokens();
    let raw = '';
    try {
        const messages = buildChatMessages(session, options);
        S.lastRequest = requestDescription(messages, limit);
        raw = await dispatch(messages, limit, job);
        const parsed = parseReply(raw);
        if (parsed.kind === REPLY_KIND.NONE && !options.catchup) throw new Error(t("선연락 확인이 아닌 요청에 [none]이 왔어요."));
        if (parsed.kind === REPLY_KIND.REPLY && !parsed.bubbles.length) throw new Error(t("문자로 표시할 답장이 비어 있어요."));
        session.lastGeneration = { durationMs: Date.now() - job.startedAt, responseChars: raw.length };
        return parsed;
    } catch (error) {
        if (job.owner() && !job.controller.signal.aborted) {
            S.lastIssue = { reason: t("답장을 받지 못했어요"), detail: String(error?.message || error),
                raw: String(raw), request: S.lastRequest, at: Date.now() };
        }
        throw error;
    } finally {
        end(job);
    }
}

export async function generateSummary(session, targets = null) {
    const job = begin('isSummarizing', session);
    try {
        const limit = getSummaryMaxTokens();
        return String(await dispatch(buildSummaryMessages(session, targets), limit, job)).trim();
    } finally { end(job); }
}

export async function estimateElapsedMinutes(session = null) {
    const messages = buildTimeEstimateMessages();
    if (!messages) return null;
    const job = begin('isEstimating', session);
    try {
        const limit = getTimeMaxTokens();
        const raw = String(await dispatch(messages, limit, job)).trim();
        if (!/^\d{1,3}$/.test(raw) || Number(raw) > 720) return null;
        return Number(raw);
    } catch (error) {
        if (error?.name !== 'AbortError') console.warn(DEBUG_PREFIX, 'time estimate failed:', error);
        return null;
    } finally { end(job); }
}

export async function generateSceneContext(session) {
    const job = begin('isSummarizing', session);
    try {
        const limit = getSummaryMaxTokens();
        const text = String(await dispatch(buildSceneContextMessages(session), limit, job)).trim();
        if (!text) throw new Error(t("상황 메모가 비어 있어요."));
        return text;
    } finally { end(job); }
}

export function abortGeneration() {
    for (const job of S.jobs) job.controller.abort(cancelled());
    S.revealController?.abort(cancelled());
    S.isGenerating = false;
    S.isSummarizing = false;
    S.isEstimating = false;
    S.abortController = null;
}
