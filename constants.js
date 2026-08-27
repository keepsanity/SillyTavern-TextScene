/** Constants (pure data only, no side effects). */

export const EXTENSION_NAME = 'SillyTavern-TextScene';
export const DEBUG_PREFIX = '[TextScene]';

/** Key in chat_metadata under which the session list lives */
export const META_KEY = EXTENSION_NAME;

export const WHO = {
    USER: 'user',
    CHAR: 'char',
};

/** Format to leave in the main chat when closing */
export const INSERT_MODE = {
    SUMMARY: 'summary',     // summary only (zero context pollution)
    BOTH: 'both',           // summary + full text log
    FULL: 'full',           // full text log only
};
export const INSERT_MODE_LABELS = {
    [INSERT_MODE.SUMMARY]: '요약만',
    [INSERT_MODE.BOTH]: '요약 + 전문',
    [INSERT_MODE.FULL]: '전문 그대로',
};

/** Language of the text inserted into the main chat (not the overlay UI language). */
export const LANG = {
    AUTO: 'auto',   // determined from the main chat content
    KO: 'ko',
    EN: 'en',
};
export const LANG_LABELS = {
    [LANG.AUTO]: '자동 (채팅에 맞춤)',
    [LANG.KO]: '한국어',
    [LANG.EN]: 'English',
};

/** Wrapper text for the inserted block. `{name}` is the character, `{count}` the message count. */
export const INSERT_LABELS = {
    [LANG.KO]: {
        header: '📱 *{name} 나눈 문자*',
        headerWithTime: '📱 *{name} 나눈 문자 — {time}*',
        logSummary: '문자 내용 ({count}통)',
    },
    [LANG.EN]: {
        header: '📱 *Texts with {name}*',
        headerWithTime: '📱 *Texts with {name} — {time}*',
        logSummary: 'Messages ({count})',
    },
};

/** Bubble separator. Only counted when it occupies an entire line by itself. */
export const BUBBLE_SPLIT_TOKEN = '---';
export const BUBBLE_SPLIT_REGEX = /^\s*-{3,}\s*$/;

/** Delay between bubbles for the typing effect (ms), scaled by character count. */
export const TYPING_DELAY_MIN = 400;
export const TYPING_DELAY_MAX = 2200;
export const TYPING_MS_PER_CHAR = 45;

/** Cap on the text log loaded into context. High enough never to bind in practice;
    it only stops a long-lived session from growing the prompt without limit. */
export const LOG_WINDOW = 200;

/** Number of recent main-chat turns loaded via the bridge */
export const DEFAULT_BRIDGE_TURNS = 3;

/** Character cap per bridge message */
export const BRIDGE_CHAR_LIMIT = 1200;

// A cap, not a spend. Thinking tokens count against it, so a tight value starves the body.
export const DEFAULT_MAX_TOKENS = 10000;

export const SUMMARY_MAX_TOKENS = 500;

// ============ Prompts ============

export const MESSENGER_SYSTEM = `<messenger_mode priority="critical">
<rule>You are {{char}}, texting {{user}} on a phone. This is a TEXT MESSAGE conversation — not prose, not a roleplay scene.</rule>
<rule>NEVER write narration, scene description, inner monologue, or *asterisk actions*. No prose of any kind. Not even one line.</rule>
<rule>Output ONLY the literal text {{char}} would type into a messaging app.</rule>
<rule>Keep each message SHORT — usually under 15 words. Real people text in fragments, not paragraphs.</rule>
<rule>Casual register is correct: lowercase, abbreviations, trailing dots, typos, emoji or emoticons — whatever fits {{char}}'s voice and age.</rule>
<rule>Send 1 to 3 separate messages per turn. Separate each one with a line containing only ${BUBBLE_SPLIT_TOKEN}</rule>
<rule>Do not resolve everything in one turn. Texting is a back-and-forth — leave room for {{user}} to reply.</rule>
<rule>Stay fully in character as {{char}}. Reply in the SAME LANGUAGE {{user}} is texting in.</rule>
<rule>Never write {{user}}'s messages. Never add a sender name or timestamp prefix.</rule>

<reply_timing priority="critical">
<rule>Begin your output with a marker alone on the first line. It says how {{char}} responds to the phone right now.</rule>

<marker_forms>
[+N]          {{char}} replies after N minutes. Write the messages after this line.
[+N silent]   {{char}} reads it after N minutes but does NOT reply. Write nothing after the marker.
[+N unread]   {{char}} has not looked at their phone at all. Write nothing after the marker.
</marker_forms>

<rule>How long someone takes to reply is part of what they are saying. Choose N from what {{char}} is doing and feeling, not at random.</rule>
<rule>0-2 when {{char}} was holding their phone, waiting for this, worried, or excited.</rule>
<rule>5-20 when {{char}} is in the middle of something ordinary — eating, showering, working, out with people.</rule>
<rule>30-120 when {{char}} is busy, distracted, sulking, playing it cool, or deliberately making {{user}} wait.</rule>
<rule>180+ when {{char}} is asleep, has their phone off, or is avoiding {{user}}.</rule>

<rule>Use [+N silent] when {{char}} would see the message and choose not to answer — hurt, angry, embarrassed, or with nothing to say. Being left on read is a real answer.</rule>
<rule>Use [+N unread] when {{char}} genuinely has no idea the message arrived — asleep, phone away, in the shower, driving.</rule>
<rule>Do NOT use silent or unread just to be dramatic. Most of the time {{char}} replies. Only go silent when this specific moment truly calls for it.</rule>
<rule>Never explain or mention the marker inside the messages. The marker line is the only place it appears.</rule>
</reply_timing>
</messenger_mode>`;

// Status marker on the response's first line: `[+45]`, `[+45 silent]`, `[+45 unread]`, `[none]`.
// Only recognized when it occupies the whole line, since bubbles follow it.
export const REPLY_MARKER_REGEX =
    /^[ 	]*\[[ 	]*(?:(none)|\+?[ 	]*(\d{1,4})[ 	]*(?:m|min|mins|minutes)?)(?:[ 	]+(silent|unread|read))?[ 	]*\][ 	]*$/im;

export const REPLY_KIND = {
    REPLY: 'reply',     // a reply came back
    SILENT: 'silent',   // read but no reply (left on read)
    UNREAD: 'unread',   // not even seen yet
    NONE: 'none',       // didn't text first
};

/** Max reply delay (minutes). Larger values are discarded as misparsed. */
export const REPLY_DELAY_MAX = 1440;

/** Gap at or above this shows a "N minutes later" note in the text window. */
export const GAP_NOTE_MINUTES = 20;

export const PROACTIVE_INSTRUCTION = `<opening_text priority="high">
<rule>{{char}} is initiating this conversation. {{user}} has not texted yet.</rule>
<rule>Send whatever {{char}} would actually text {{user}} out of the blue right now, given the situation.</rule>
<rule>Do NOT comment on the fact that you are starting a conversation. Just text.</rule>
</opening_text>`;

export const CATCHUP_INSTRUCTION = `<catchup_check priority="critical">
<rule>Time has passed since the last text, and the scene below happened in between.</rule>
<rule>Decide whether {{char}} would have texted {{user}} FIRST during that time, without being messaged.</rule>
<rule>People usually do not text out of nowhere. Answer [none] unless {{char}} has a real reason — something happened, they promised to, they are worried, they cannot stop thinking about {{user}}, or something in the scene below would push them to reach out.</rule>
<rule>If {{char}} would have texted, use [+N] where N is minutes since the last message, then write what they sent.</rule>
<rule>Do not answer {{user}}'s last message here. This is {{char}} starting something new.</rule>
</catchup_check>`;

/** Wrapper around the main chat's recent turns; `{{scene}}` is the original text. */
export const BRIDGE_TEMPLATE = `<recent_events>
This is what happened between {{char}} and {{user}} most recently, before this text conversation.
Use it only to know where things stand. Do NOT narrate it, quote it, or summarize it back.
{{scene}}
</recent_events>`;

/** Summary generation prompt; `{{log}}` is the text log. */
export const SUMMARY_PROMPT = `<summary_task priority="critical">
<rule>Summarize the text message exchange below. This is a DATA EXTRACTION task, NOT roleplay.</rule>
<rule>Write 1-3 short sentences of plain narration, past tense, third person.</rule>
<rule>Keep only what still matters afterwards: decisions, plans, promises, new information, and any real shift in mood or in the relationship.</rule>
<rule>Drop the small talk. If the whole exchange was affectionate chatter and nothing was decided, say exactly that in one sentence.</rule>
<rule>Output ONLY the summary. No preamble, no labels, no quotes, no code fences.</rule>
</summary_task>

<messages>
{{log}}
</messages>

Write the summary now:`;

/** Prompt for estimating minutes elapsed between the previous scene and the text scene. */
export const TIME_ESTIMATE_PROMPT = `<time_estimate_task priority="critical">
<rule>This is a DATA ESTIMATION task, NOT roleplay. Do not write dialogue, narration, or explanation.</rule>
<rule>The scene below just happened. {{user}} is now about to text {{char}}.</rule>
<rule>Estimate how many MINUTES have plausibly passed between the end of that scene and the moment {{user}} starts texting.</rule>
<rule>Account for what {{user}} would realistically do first — travelling home, finishing something, settling in.</rule>
<rule>If {{user}} would text right away, answer 0.</rule>
<rule>Answer with ONLY a whole number between 0 and 720. No words, no units, no punctuation, no quotes.</rule>
</time_estimate_task>

<scene>
{{scene}}
</scene>

Minutes elapsed:`;

// Needs headroom for a preamble before the number, or the answer is truncated away.
export const TIME_ESTIMATE_MAX_TOKENS = 48;

/** Max trusted elapsed-time estimate (minutes). */
export const TIME_ESTIMATE_MAX_MINUTES = 720;

export const SUMMARY_LOG_PLACEHOLDER = '{{log}}';
export const BRIDGE_SCENE_PLACEHOLDER = '{{scene}}';

/** Key planted in a message's `extra` to identify an inserted text block. */
export const INSERT_MARKER = 'textscene_session';

export const HISTORY_BTN_CLASS = 'ts-open-history';
