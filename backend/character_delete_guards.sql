-- All functions are VOLATILE: after a waiting advisory lock, subsequent reads
-- see the committed tombstone at READ COMMITTED (the application isolation).
CREATE OR REPLACE FUNCTION gojo_assert_live(cid text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF cid IS NOT NULL AND EXISTS (
    SELECT 1 FROM character_tombstones WHERE character_id = cid
  ) THEN
    RAISE EXCEPTION 'character permanently deleted' USING ERRCODE = 'P0001';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION gojo_write_fence() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE cid text;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'character writes require READ COMMITTED';
  END IF;
  PERFORM pg_advisory_xact_lock_shared(714230981056::bigint);
  FOR cid IN SELECT jsonb_array_elements_text(
    COALESCE(NULLIF(current_setting('gojo.source_characters', true), ''), '[]')::jsonb
  ) LOOP
    PERFORM gojo_assert_live(cid);
  END LOOP;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION gojo_character_row_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE cid text; item jsonb; payload jsonb; target_fact integer;
BEGIN
  IF TG_TABLE_NAME = 'characters' THEN
    cid := NEW.id;
    IF cid IN ('shared', 'user') THEN RAISE EXCEPTION 'reserved character id'; END IF;
  ELSIF TG_TABLE_NAME = 'diary_book' THEN
    cid := NULLIF(NEW.owner, 'user');
  ELSIF TG_TABLE_NAME = 'char_diary_comment' THEN
    SELECT character_id INTO cid FROM char_diary WHERE id = NEW.diary_id;
    IF cid IS NULL THEN RAISE EXCEPTION 'missing character diary'; END IF;
  ELSIF TG_TABLE_NAME = 'gojo_memory' THEN
    cid := 'gojo';
  ELSE
    cid := NEW.character_id;
  END IF;
  PERFORM gojo_assert_live(cid);
  IF TG_TABLE_NAME = 'memory_jobs' THEN
    IF NEW.kind = 'group' THEN
      payload := NEW.extra_json::jsonb;
      IF payload IS NULL OR jsonb_typeof(payload) <> 'object'
         OR jsonb_typeof(payload->'members') IS DISTINCT FROM 'array'
         OR jsonb_array_length(payload->'members') = 0
         OR jsonb_typeof(payload->'round_transcript') IS DISTINCT FROM 'string'
         OR (payload - 'members' - 'round_transcript') <> '{}'::jsonb THEN
        RAISE EXCEPTION 'unrecognized group job payload';
      END IF;
      FOR item IN SELECT jsonb_array_elements(payload->'members') LOOP
        IF jsonb_typeof(item) <> 'object' OR jsonb_typeof(item->'id') IS DISTINCT FROM 'string'
           OR COALESCE(item->>'id', '') = ''
           OR jsonb_typeof(item->'name') IS DISTINCT FROM 'string'
           OR (item - 'id' - 'name') <> '{}'::jsonb THEN
          RAISE EXCEPTION 'unrecognized group member identity';
        END IF;
        PERFORM gojo_assert_live(item->>'id');
      END LOOP;
    ELSIF NEW.kind <> 'private' OR NEW.character_id IS NULL OR NEW.extra_json IS NOT NULL THEN
      RAISE EXCEPTION 'unrecognized memory job';
    END IF;
  ELSIF TG_TABLE_NAME = 'bond_memory' THEN
    target_fact := (to_jsonb(NEW)->>'linked_fact_id')::integer;
    IF target_fact IS NOT NULL AND NOT EXISTS (SELECT 1 FROM long_memory WHERE id = target_fact) THEN
      RAISE EXCEPTION 'missing linked fact';
    END IF;
  END IF;
  RETURN NEW;
END $$;
