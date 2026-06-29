CREATE TEMP TABLE table_counts (
  table_name text PRIMARY KEY,
  row_count bigint NOT NULL
);

DO $$
DECLARE
  table_record record;
BEGIN
  FOR table_record IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  LOOP
    EXECUTE format(
      'INSERT INTO table_counts(table_name, row_count) SELECT %L, count(*)::bigint FROM %I.%I',
      table_record.tablename,
      table_record.schemaname,
      table_record.tablename
    );
  END LOOP;
END $$;

SELECT table_name || E'\t' || row_count
FROM table_counts
ORDER BY table_name;
