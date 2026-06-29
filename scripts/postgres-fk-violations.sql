CREATE TEMP TABLE fk_violations (
  constraint_name text NOT NULL,
  child_table text NOT NULL,
  parent_table text NOT NULL,
  violation_count bigint NOT NULL
);

DO $$
DECLARE
  fk_record record;
  join_condition text;
  not_null_condition text;
  parent_missing_condition text;
  violation_count bigint;
BEGIN
  FOR fk_record IN
    SELECT oid, conname, conrelid, confrelid
    FROM pg_constraint
    WHERE contype = 'f'
    ORDER BY conname
  LOOP
    SELECT
      string_agg(format('child.%I = parent.%I', child_attribute.attname, parent_attribute.attname), ' AND ' ORDER BY key_pair.ordinality),
      string_agg(format('child.%I IS NOT NULL', child_attribute.attname), ' AND ' ORDER BY key_pair.ordinality),
      (array_agg(format('parent.%I IS NULL', parent_attribute.attname) ORDER BY key_pair.ordinality))[1]
    INTO join_condition, not_null_condition, parent_missing_condition
    FROM unnest(
      (SELECT conkey FROM pg_constraint WHERE oid = fk_record.oid),
      (SELECT confkey FROM pg_constraint WHERE oid = fk_record.oid)
    ) WITH ORDINALITY AS key_pair(child_attnum, parent_attnum, ordinality)
    JOIN pg_attribute child_attribute
      ON child_attribute.attrelid = fk_record.conrelid
     AND child_attribute.attnum = key_pair.child_attnum
    JOIN pg_attribute parent_attribute
      ON parent_attribute.attrelid = fk_record.confrelid
     AND parent_attribute.attnum = key_pair.parent_attnum;

    EXECUTE format(
      'SELECT count(*)::bigint FROM %s child LEFT JOIN %s parent ON %s WHERE %s AND %s',
      fk_record.conrelid::regclass,
      fk_record.confrelid::regclass,
      join_condition,
      not_null_condition,
      parent_missing_condition
    )
    INTO violation_count;

    IF violation_count > 0 THEN
      INSERT INTO fk_violations(constraint_name, child_table, parent_table, violation_count)
      VALUES (
        fk_record.conname,
        fk_record.conrelid::regclass::text,
        fk_record.confrelid::regclass::text,
        violation_count
      );
    END IF;
  END LOOP;
END $$;

SELECT constraint_name || E'\t' || child_table || E'\t' || parent_table || E'\t' || violation_count
FROM fk_violations
ORDER BY constraint_name;
