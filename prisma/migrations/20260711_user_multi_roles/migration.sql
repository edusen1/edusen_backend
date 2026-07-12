-- Add roles array to users for multi-role support
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "roles" "UserRole"[] DEFAULT ARRAY[]::"UserRole"[];
