/** Versioned links between the phone log and the RP message that contains it. */
import { chat } from '../../../../script.js';
import { uuidv4 } from '../../../utils.js';
import { INSERT_MARKER } from './constants.js';

export function fingerprint(messages) {
    return JSON.stringify(messages.map(m => [m.id, m.text, m.who, m.clock, m.date, m.kind ?? 'text']));
}

export function getCommits(session) {
    session.commits ??= [];
    if (!session.commitMigrationDone) {
        // Old versions only stored a count. Map existing inserted texts in order, without deleting any data.
        const inserted = session.messages.filter(m => m.inserted);
        let offset = 0;
        for (const message of chat) {
            const marker = message.extra?.[INSERT_MARKER];
            if (marker?.sessionId !== session.id || session.commits.some(c => c.id === marker.commitId)) continue;
            const targets = inserted.slice(offset, offset + (Number(marker.count) || 0));
            offset += targets.length;
            const id = marker.commitId || uuidv4();
            marker.commitId = id;
            session.commits.push({ id, messageIds: targets.map(m => m.id), fingerprint: fingerprint(targets),
                lastText: message.mes, mode: marker.mode, summary: '', saved: true, revisions: [] });
        }
        session.commitMigrationDone = true;
    }
    return session.commits;
}

export function findCommitMessage(commit) {
    return chat.find(m => m.extra?.[INSERT_MARKER]?.commitId === commit.id) ?? null;
}

/** Edits are reconciled one existing RP block at a time, before adding any new batch. */
export function getCommitBatch(session) {
    for (const commit of getCommits(session)) {
        const ids = new Set(commit.messageIds);
        const messages = session.messages.filter(m => ids.has(m.id));
        if (commit.forceDirty || !commit.saved || !findCommitMessage(commit) || fingerprint(messages) !== commit.fingerprint) {
            return { commit, messages, replacement: true };
        }
    }
    const covered = new Set(getCommits(session).flatMap(c => c.messageIds));
    return { commit: null, messages: session.messages.filter(m => !covered.has(m.id) && !m.inserted), replacement: false };
}

export function hasPendingChanges(session) {
    if (!session) return false;
    const batch = getCommitBatch(session);
    return batch.replacement || batch.messages.length > 0;
}

export function invalidateFrom(session, messageId) {
    const index = session.messages.findIndex(m => m.id === messageId);
    const ids = new Set(session.messages.slice(index).map(m => m.id));
    for (const commit of getCommits(session)) {
        if (commit.messageIds.some(id => ids.has(id))) commit.forceDirty = true;
    }
}
