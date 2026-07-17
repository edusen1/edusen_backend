-- Make username unique (partial index — only non-null values)
CREATE UNIQUE INDEX IF NOT EXISTS "users_username_unique" ON "User" ("username") WHERE "username" IS NOT NULL;
