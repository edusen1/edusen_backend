DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum
    WHERE enumlabel = 'COMPTABLE'
      AND enumtypid = '"UserRole"'::regtype
  ) THEN
    ALTER TYPE "UserRole" ADD VALUE 'COMPTABLE';
  END IF;
END $$;
