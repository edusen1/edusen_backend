-- CreateEnum
CREATE TYPE "StatutDemande" AS ENUM ('EN_ATTENTE', 'APPROUVEE', 'REJETEE');

-- CreateEnum
CREATE TYPE "TypeSanction" AS ENUM ('AVERTISSEMENT', 'BLAME', 'RETENUE', 'EXCLUSION_COURS', 'EXCLUSION_TEMPORAIRE', 'EXCLUSION_DEFINITIVE', 'TRAVAUX_INTERET_SCOLAIRE', 'CONSEIL_DISCIPLINE');

-- CreateEnum
CREATE TYPE "StatutDiscipline" AS ENUM ('OUVERT', 'EN_TRAITEMENT', 'CLOTURE', 'APPEL', 'ANNULE');

-- CreateEnum
CREATE TYPE "RoleRapporteur" AS ENUM ('ADMIN', 'ENSEIGNANT', 'PROFESSEUR', 'SURVEILLANT', 'ELEVE', 'PERSONNEL', 'PARENT');

-- CreateEnum
CREATE TYPE "StatutAbsenceEnseignant" AS ENUM ('EN_ATTENTE', 'APPROUVEE', 'REJETEE');

-- CreateEnum
CREATE TYPE "StatutChapitre" AS ENUM ('NON_COMMENCE', 'EN_COURS', 'TERMINE');

-- AlterEnum
ALTER TYPE "TypeEvaluation" ADD VALUE 'BONUS';

-- DropForeignKey
ALTER TABLE "communications" DROP CONSTRAINT "communications_tenantId_fkey";

-- DropIndex
DROP INDEX "convocations_tenantId_type_idx";

-- AlterTable
ALTER TABLE "AbsenceEnseignant" ADD COLUMN     "heureDebut" VARCHAR(5),
ADD COLUMN     "heureFin" VARCHAR(5),
ADD COLUMN     "statut" "StatutAbsenceEnseignant" NOT NULL DEFAULT 'EN_ATTENTE',
ADD COLUMN     "typeAbsence" VARCHAR(20) NOT NULL DEFAULT 'AUTRE';

-- AlterTable
ALTER TABLE "AbsencePersonnel" ADD COLUMN     "userId" UUID;

-- AlterTable
ALTER TABLE "ChapitreProgamme" RENAME CONSTRAINT "chapitres_programme_pkey" TO "ChapitreProgamme_pkey";
ALTER TABLE "ChapitreProgamme" ADD COLUMN     "dateDebut" TIMESTAMP(3),
ADD COLUMN     "dateTermine" TIMESTAMP(3),
ADD COLUMN     "statut" "StatutChapitre" NOT NULL DEFAULT 'NON_COMMENCE',
ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "DemandeAudit" RENAME CONSTRAINT "demandes_audit_pkey" TO "DemandeAudit_pkey";
ALTER TABLE "DemandeAudit" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "MatiereNiveau" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Note" ADD COLUMN     "coursId" UUID;

-- AlterTable
ALTER TABLE "PaiementProfesseur" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PresenceCoursProfesseur" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ProfesseurMatiere" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ProgrammePedagogique" RENAME CONSTRAINT "programmes_pedagogiques_pkey" TO "ProgrammePedagogique_pkey";
ALTER TABLE "ProgrammePedagogique" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "UserFeatureSeen" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "communications" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ecole_palette_configs" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "eleve_documents" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "DemandeReduction" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "eleveId" UUID NOT NULL,
    "inscriptionId" UUID,
    "pourcentage" DOUBLE PRECISION NOT NULL,
    "motif" TEXT NOT NULL,
    "statut" "StatutDemande" NOT NULL DEFAULT 'EN_ATTENTE',
    "demandePar" UUID NOT NULL,
    "traitePar" UUID,
    "commentaireAdmin" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DemandeReduction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Discipline" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "eleveId" UUID,
    "classeId" UUID,
    "eleveNom" VARCHAR(200) NOT NULL,
    "eleveClasse" VARCHAR(100),
    "type" "TypeSanction" NOT NULL DEFAULT 'AVERTISSEMENT',
    "motif" TEXT NOT NULL,
    "dateIncident" TIMESTAMP(3) NOT NULL,
    "gravite" INTEGER NOT NULL DEFAULT 2,
    "statut" "StatutDiscipline" NOT NULL DEFAULT 'OUVERT',
    "sanction" TEXT,
    "compteRendu" TEXT,
    "dateDecision" TIMESTAMP(3),
    "rapporteur" VARCHAR(200),
    "rapporteurRole" "RoleRapporteur",
    "signaleParId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Discipline_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DemandeReduction_tenantId_statut_idx" ON "DemandeReduction"("tenantId", "statut");

-- CreateIndex
CREATE INDEX "DemandeReduction_tenantId_eleveId_idx" ON "DemandeReduction"("tenantId", "eleveId");

-- CreateIndex
CREATE INDEX "Discipline_tenantId_statut_idx" ON "Discipline"("tenantId", "statut");

-- CreateIndex
CREATE INDEX "Discipline_tenantId_dateIncident_idx" ON "Discipline"("tenantId", "dateIncident");

-- CreateIndex
CREATE INDEX "Discipline_tenantId_signaleParId_idx" ON "Discipline"("tenantId", "signaleParId");

-- RenameForeignKey
ALTER TABLE "DemandeAudit" RENAME CONSTRAINT "demandes_audit_demandePar_fkey" TO "DemandeAudit_demandePar_fkey";

-- RenameForeignKey
ALTER TABLE "DemandeAudit" RENAME CONSTRAINT "demandes_audit_tenantId_fkey" TO "DemandeAudit_tenantId_fkey";

-- AddForeignKey
ALTER TABLE "Cours" ADD CONSTRAINT "Cours_enseignantId_fkey" FOREIGN KEY ("enseignantId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemandeReduction" ADD CONSTRAINT "DemandeReduction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemandeReduction" ADD CONSTRAINT "DemandeReduction_eleveId_fkey" FOREIGN KEY ("eleveId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemandeReduction" ADD CONSTRAINT "DemandeReduction_inscriptionId_fkey" FOREIGN KEY ("inscriptionId") REFERENCES "Inscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemandeReduction" ADD CONSTRAINT "DemandeReduction_demandePar_fkey" FOREIGN KEY ("demandePar") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemandeReduction" ADD CONSTRAINT "DemandeReduction_traitePar_fkey" FOREIGN KEY ("traitePar") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_coursId_fkey" FOREIGN KEY ("coursId") REFERENCES "Cours"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communications" ADD CONSTRAINT "communications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemandePassage" ADD CONSTRAINT "DemandePassage_eleveId_fkey" FOREIGN KEY ("eleveId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemandePassage" ADD CONSTRAINT "DemandePassage_creePar_fkey" FOREIGN KEY ("creePar") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemandePassage" ADD CONSTRAINT "DemandePassage_traitePar_fkey" FOREIGN KEY ("traitePar") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discipline" ADD CONSTRAINT "Discipline_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "calendrier_scolaires_tenant_type_idx" RENAME TO "CalendrierScolaire_tenantId_type_idx";

-- RenameIndex
ALTER INDEX "demandes_audit_tenant_statut_idx" RENAME TO "DemandeAudit_tenantId_statut_idx";

-- RenameIndex
ALTER INDEX "ProgrammePedagogique_tenantId_niveauId_matiereId_anneeAcademiqu" RENAME TO "ProgrammePedagogique_tenantId_niveauId_matiereId_anneeAcade_key";

-- RenameIndex
ALTER INDEX "programmes_pedagogiques_tenant_annee_idx" RENAME TO "ProgrammePedagogique_tenantId_anneeAcademiqueId_idx";
