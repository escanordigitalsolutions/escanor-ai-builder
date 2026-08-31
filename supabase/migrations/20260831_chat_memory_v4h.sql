-- Chat memory (v4H)
--
-- The AI Editor's chat replayed the last few messages and nothing else, so a
-- conversation's standing facts — the brand colour, the thing not to touch, the
-- page being worked on — survived only as long as they stayed inside the replay
-- window. Past that the model forgot what the conversation was about, and the
-- person had no way to see what it still held.
--
-- One short list per conversation, rewritten after each turn, fed back into the
-- prompt and shown in the editor as chips. Cleared by starting a new chat,
-- because that is what starting a new chat means.

alter table public.ai_conversations
  add column if not exists memory jsonb;

comment on column public.ai_conversations.memory is
  'Short standing facts for this conversation, newest first. Written by the cheap model after each turn, shown to the user, and included in the system prompt.';
