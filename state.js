/** Ephemeral UI/progress state shared across modules. */
export const S = {
    isOpen: false,
    activeSessionId: null,
    sheetEl: null,
    /** History viewing mode — input and actions disabled */
    isReadonly: false,

    isGenerating: false,
    abortController: null,
    /** Bubble reveal animation running */
    isRevealing: false,
    skipReveal: false,

    /** Asking the model for the gap since the previous scene */
    isEstimating: false,

    isSummarizing: false,
    summaryDraft: '',

    /** { reason, detail, raw, at } */
    lastIssue: null,

    /** Redacted copy of the last outgoing generation payload, for the issue card. */
    lastRequest: '',

    /** id of the message being edited in place */
    editingId: null,
    /** id of the message whose action menu is open */
    actionMenuFor: null,
};
