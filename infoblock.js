/** Reads the scene's in-story time and date from an infoblock in the main chat. */

import { getContext } from '../../../extensions.js';
import { DEBUG_PREFIX } from './constants.js';
import { getTimeRegexSource, getDateRegexSource, isInfoblockTimeEnabled } from './config.js';

/** Recent messages to scan, newest-first. */
const SCAN_DEPTH = 12;

/** @returns {number|null} Minutes since midnight, or null if unparsable. */
export function parseClockText(text) {
    const raw = String(text ?? '').trim();
    if (!raw) return null;

    const m = raw.match(/(\d{1,2})\s*:\s*(\d{2})\s*([ap])\.?\s*m\.?/i);
    if (m) {
        let hours = Number(m[1]);
        const minutes = Number(m[2]);
        if (hours > 12 || minutes > 59) return null;
        const isPm = m[3].toLowerCase() === 'p';
        // 12 am = hour 0, 12 pm = hour 12.
        if (hours === 12) hours = 0;
        if (isPm) hours += 12;
        return hours * 60 + minutes;
    }

    // Korean AM/PM markers. Must precede the 24-hour branch, which would otherwise match first.
    const mKo = raw.match(/(오전|오후)\s*(\d{1,2})\s*[:시]\s*(\d{1,2})?/);
    if (mKo) {
        let hours = Number(mKo[2]);
        const minutes = Number(mKo[3] ?? 0);
        if (hours > 12 || minutes > 59) return null;
        if (hours === 12) hours = 0;
        if (mKo[1] === '오후') hours += 12;
        return hours * 60 + minutes;
    }

    const m24 = raw.match(/(\d{1,2})\s*:\s*(\d{2})/);
    if (m24) {
        const hours = Number(m24[1]);
        const minutes = Number(m24[2]);
        if (hours > 23 || minutes > 59) return null;
        return hours * 60 + minutes;
    }

    return null;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Parses an `MM.DD.YYYY Weekday` date. Returns null on mismatch.
 * @returns {{year:number, month:number, day:number, hasWeekday:boolean}|null}
 */
export function parseSceneDate(text) {
    const raw = String(text ?? '').trim();
    if (!raw) return null;

    const m = raw.match(/(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/);
    if (!m) return null;

    const month = Number(m[1]);
    const day = Number(m[2]);
    const year = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;

    // Round-trip check: Date silently rolls invalid days into the next month.
    const probe = new Date(year, month - 1, day);
    if (probe.getMonth() !== month - 1 || probe.getDate() !== day) return null;

    return {
        year,
        month,
        day,
        hasWeekday: WEEKDAYS.some(w => raw.toLowerCase().includes(w.toLowerCase())),
    };
}

/** Formats an `MM.DD.YYYY Weekday` date, shifted by dayOffset days. */
export function formatSceneDate(date, dayOffset = 0) {
    if (!date) return '';
    const d = new Date(date.year, date.month - 1, date.day + dayOffset);
    const stamp = [
        String(d.getMonth() + 1).padStart(2, '0'),
        String(d.getDate()).padStart(2, '0'),
        d.getFullYear(),
    ].join('.');
    return date.hasWeekday ? `${stamp} ${WEEKDAYS[d.getDay()]}` : stamp;
}

/** Formats minutes-since-midnight in 12-hour notation. */
export function formatSceneClock(totalMinutes) {
    const wrapped = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
    const hours24 = Math.floor(wrapped / 60);
    const minutes = wrapped % 60;
    const suffix = hours24 >= 12 ? 'pm' : 'am';
    const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
    return `${hours12}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

/** Cap (minutes) on in-story time elapsed between two texts. */
const MAX_STEP_MINUTES = 3;

/** Idle time after which the anchor is re-read from the infoblock. */
const RESUME_AFTER_MS = 30 * 60 * 1000;

function readSceneNow() {
    const minutes = readSceneTime();
    const date = readSceneDate();
    return { minutes, date: date?.parsed ?? null, dateRaw: date?.raw ?? '' };
}

/** Builds the display strings from the session anchor plus accumulated minutes. */
function stampFrom(session, sceneMin) {
    if (sceneMin == null) return { sceneMin: null, clock: '', date: session?.anchorDateRaw || '' };
    const dayOffset = Math.floor(sceneMin / 1440);
    return {
        sceneMin,
        clock: formatSceneClock(sceneMin),
        date: session?.anchorDate
            ? formatSceneDate(session.anchorDate, dayOffset)
            // Unparsed dates can't be rolled over, so show the raw text.
            : (session?.anchorDateRaw || ''),
    };
}

/**
 * Computes the in-story time/date to stamp on a newly sent text. Called once at send time;
 * the result is stored on the message and never recomputed.
 * @param {number} nowMs Real-world send time, in ms
 * @returns {{sceneMin: number|null, clock: string, date: string}}
 */
export function nextStamp(session, nowMs, { delayMinutes = null } = {}) {
    const messages = session?.messages ?? [];
    // Older texts may have no stamp, so search backwards for the last one that does.
    let prev = null;
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i]?.sceneMin != null) { prev = messages[i]; break; }
    }

    const scene = readSceneNow();

    // With no prior text to anchor to, the current infoblock reading is the anchor,
    // offset by timeShift (time elapsed since the last scene).
    if (!prev) {
        applyAnchor(session, scene);
        const shift = Number(session?.timeShift) || 0;
        return stampFrom(session, scene.minutes == null ? null : scene.minutes + shift + (delayMinutes ?? 0));
    }

    // An explicit reply delay wins; otherwise use clamped real elapsed time.
    // Editing/deleting a later-day burst may expose a previous message with a different anchor.
    session.anchorDate = messageAnchor(prev, session);
    session.anchorDateRaw = prev.anchorDateRaw || prev.date || session.anchorDateRaw;
    const idleMs = nowMs - (prev.at ?? nowMs);
    const step = delayMinutes != null
        ? Math.max(0, Math.round(delayMinutes))
        : Math.min(Math.max(0, Math.round(idleMs / 60000)), MAX_STEP_MINUTES);
    const stepped = prev.sceneMin + step;

    // After a long pause, re-anchor to the infoblock, but only if it moved forward.
    if (delayMinutes == null && (idleMs >= RESUME_AFTER_MS || session.resumeScene) && scene.minutes != null) {
        session.resumeScene = false;
        const jumped = resumeTarget(session, scene, stepped);
        if (jumped != null) {
            applyAnchor(session, scene);
            return stampFrom(session, jumped);
        }
    }

    return stampFrom(session, stepped);
}

/** Returns the minutes to jump to on resume, or null to stay put. */
function resumeTarget(session, scene, stepped) {
    const prevDate = session?.anchorDate;
    if (prevDate && scene.date) {
        const prevDay = Date.UTC(prevDate.year, prevDate.month - 1, prevDate.day);
        const nowDay = Date.UTC(scene.date.year, scene.date.month - 1, scene.date.day);
        const prevAbs = prevDay / 60000 + stepped;
        const nowAbs = nowDay / 60000 + scene.minutes;
        return nowAbs > prevAbs ? scene.minutes : null;
    }
    // Without a date, compare within the day only.
    return scene.minutes > (stepped % 1440) ? scene.minutes : null;
}

function applyAnchor(session, scene) {
    if (!session) return;
    session.anchorDate = scene.date;
    session.anchorDateRaw = scene.dateRaw;
}

/** Shifts every stamped message by deltaMinutes, preserving the gaps between them. */
export function restampMessages(session, deltaMinutes) {
    const delta = Math.round(Number(deltaMinutes) || 0);
    if (!delta || !session?.messages?.length) return;
    for (const message of session.messages) {
        if (message?.sceneMin == null) continue;
        const anchorDate = messageAnchor(message, session);
        message.sceneMin = Math.max(0, message.sceneMin + delta);
        message.anchorDate = anchorDate;
        const stamp = stampFrom({ anchorDate, anchorDateRaw: message.anchorDateRaw || message.date || session.anchorDateRaw }, message.sceneMin);
        message.clock = stamp.clock;
        message.date = stamp.date;
    }
}

function messageAnchor(message, session) {
    if (message.anchorDate) return message.anchorDate;
    const date = parseSceneDate(message.date);
    return date ? parseSceneDate(formatSceneDate(date, -Math.floor((message.sceneMin || 0) / 1440))) : session.anchorDate;
}

export function sceneClockFor(session, message) {
    return message?.clock || '';
}

export function sceneDateFor(session, message) {
    return message?.date || '';
}

/** Clock of the most recent stamped text, i.e. where the scene stands now. */
export function sceneLatestClock(session) {
    const messages = session?.messages ?? [];
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i]?.clock) return messages[i].clock;
    }
    return '';
}

export function sceneStartDate(session) {
    return session?.messages?.find(m => m.date)?.date || '';
}

/** Returns the first capture group of a regex across recent main-chat messages. */
function scanRecent(regexSource) {
    if (!regexSource) return null;
    let regex;
    try {
        regex = new RegExp(regexSource, 'i');
    } catch (error) {
        // The pattern is user-editable in settings, so it can be malformed.
        console.warn(DEBUG_PREFIX, 'invalid regex:', error);
        return null;
    }

    try {
        const chat = getContext().chat ?? [];
        for (let i = chat.length - 1; i >= 0 && i >= chat.length - SCAN_DEPTH; i--) {
            const message = chat[i];
            if (!message) continue;
            const found = String(message.mes ?? '').match(regex);
            if (found?.[1]) return found[1].trim();
        }
    } catch (error) {
        console.warn(DEBUG_PREFIX, 'infoblock scan failed:', error);
    }
    return null;
}

/** @returns {number|null} Minutes since midnight, or null if not found. */
export function readSceneTime() {
    if (!isInfoblockTimeEnabled()) return null;
    const text = scanRecent(getTimeRegexSource());
    return text === null ? null : parseClockText(text);
}

/** @returns {{raw: string, parsed: object|null}|null} null if not found. */
export function readSceneDate() {
    if (!isInfoblockTimeEnabled()) return null;
    const raw = scanRecent(getDateRegexSource());
    if (!raw) return null;
    return { raw, parsed: parseSceneDate(raw) };
}
