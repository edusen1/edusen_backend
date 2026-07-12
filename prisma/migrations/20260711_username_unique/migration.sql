-- Make username unique (partial index — only non-null values)
CREATE UNIQUE INDEX IF NOT EXISTS "users_username_unique" ON "users" ("username") WHERE "username" IS NOT NULL;
