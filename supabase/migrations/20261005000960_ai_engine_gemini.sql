-- The AI provider is chosen on the server by which key is set (GEMINI_API_KEY first, else ANTHROPIC_API_KEY;
-- supabase/functions/_shared/http.ts). A draft records the engine that actually produced it, taken from the model
-- that answered: 'gemini-…' → 'gemini', anything else → 'claude'. save_ai_draft still never accepts an engine from
-- the caller (only_keys); this trigger sets it on insert, and engine stays immutable afterwards.

create function app.ai_draft_engine() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.engine := case when new.model like 'gemini%' then 'gemini' else 'claude' end;
  return new;
end $$;

create trigger ai_drafts_engine before insert on public.ai_drafts
  for each row execute function app.ai_draft_engine();

do $$ begin perform app.apply_api_grants(); end $$;
