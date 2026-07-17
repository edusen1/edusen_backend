-- Add roles array to users for multi-role support
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "roles" "UserRole"[] DEFAULT ARRAY[]::"UserRole"[];
