DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TypeDocument') THEN
    CREATE TYPE "TypeDocument" AS ENUM (
      'EXTRAIT_NAISSANCE',
      'PHOTO_CNI',
      'VISITE_MEDICALE',
      'CARNET_SANTE',
      'VACCINATION',
      'DIPLOME',
      'PHOTO',
      'AUTRE'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "eleve_documents" (
  "id"           UUID            NOT NULL,
  "tenantId"     UUID            NOT NULL,
  "eleveId"      UUID            NOT NULL,
  "type"         "TypeDocument"  NOT NULL,
  "nom"          VARCHAR(300)    NOT NULL,
  "fileKey"      VARCHAR(1000)   NOT NULL,
  "mimeType"     VARCHAR(100)    NOT NULL,
  "taille"       INTEGER         NOT NULL,
  "uploadedById" UUID,
  "createdAt"    TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "eleve_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "eleve_documents_tenantId_eleveId_idx"
  ON "eleve_documents"("tenantId", "eleveId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'eleve_documents_tenantId_fkey'
  ) THEN
    ALTER TABLE "eleve_documents"
      ADD CONSTRAINT "eleve_documents_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'eleve_documents_eleveId_fkey'
  ) THEN
    ALTER TABLE "eleve_documents"
      ADD CONSTRAINT "eleve_documents_eleveId_fkey"
      FOREIGN KEY ("eleveId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
