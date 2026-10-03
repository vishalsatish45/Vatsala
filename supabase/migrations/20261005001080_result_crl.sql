-- Scan results: the CRL (crown-rump length, mm) as written on the report, its own column. Recorded, never interpreted.
-- record_result and correct_result take `crl_mm` (each redefined from its current definition with the column added).

alter table public.investigation_results add column crl_mm numeric check (crl_mm > 0 and crl_mm <= 200);

do $$
declare
  src text;
  edits text[][];
  fn text;
  e int;
begin
  -- record_result: accept the key, insert the column
  select pg_get_functiondef('public.record_result(jsonb)'::regprocedure) into src;
  edits := array[
    array[$a$'lab_flag','reported_at','note','source','document_id','supersedes']$a$, $b$'lab_flag','reported_at','note','source','document_id','supersedes','crl_mm']$b$],
    array[$a$entered_by, source, document_id, note, status, supersedes)$a$, $b$entered_by, source, document_id, note, status, supersedes, crl_mm)$b$],
    array[$a$(p ->> 'supersedes')::uuid)$a$, $b$(p ->> 'supersedes')::uuid, (p ->> 'crl_mm')::numeric)$b$]
  ];
  for e in 1 .. array_length(edits, 1) loop
    if position(edits[e][1] in src) = 0 then raise exception 'result_crl: record_result edit % not found', e; end if;
    src := replace(src, edits[e][1], edits[e][2]);
  end loop;
  execute src;

  -- correct_result: the same for a corrected version
  select pg_get_functiondef('public.correct_result(jsonb)'::regprocedure) into src;
  edits := array[
    array[$a$'value_num','value_text','unit','note','reported_at']$a$, $b$'value_num','value_text','unit','note','reported_at','crl_mm']$b$],
    array[$a$entered_by, source, document_id, note, status, supersedes)$a$, $b$entered_by, source, document_id, note, status, supersedes, crl_mm)$b$],
    array[$a$'corrected', prev.id)$a$, $b$'corrected', prev.id, (p ->> 'crl_mm')::numeric)$b$]
  ];
  for e in 1 .. array_length(edits, 1) loop
    if position(edits[e][1] in src) = 0 then raise exception 'result_crl: correct_result edit % not found', e; end if;
    src := replace(src, edits[e][1], edits[e][2]);
  end loop;
  execute src;
end $$;

do $$ begin perform app.apply_api_grants(); end $$;
