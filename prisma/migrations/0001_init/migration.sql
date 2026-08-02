-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'GESTIONNAIRE', 'ADMIN', 'CAISSIER', 'COMPTABLE', 'SURVEILLANT', 'SECURITE', 'ENSEIGNANT', 'ELEVE', 'PARENT', 'RH');

-- CreateEnum
CREATE TYPE "RolePlateforme" AS ENUM ('SUPER_ADMIN', 'GESTIONNAIRE');

-- CreateEnum
CREATE TYPE "Genre" AS ENUM ('M', 'F', 'AUTRE');

-- CreateEnum
CREATE TYPE "LienParente" AS ENUM ('PERE', 'MERE', 'TUTEUR', 'TUTRICE', 'ONCLE', 'TANTE', 'GRAND_PERE', 'GRAND_MERE', 'AUTRE');

-- CreateEnum
CREATE TYPE "TypeEvaluation" AS ENUM ('DEVOIR', 'INTERROGATION', 'EXAMEN', 'COMPOSITION', 'CONTROLE', 'TP', 'ORAL', 'BONUS');

-- CreateEnum
CREATE TYPE "StatutPaiement" AS ENUM ('EN_ATTENTE', 'VALIDE', 'REJETE');

-- CreateEnum
CREATE TYPE "TypePaiement" AS ENUM ('SCOLARITE', 'INSCRIPTION', 'CANTINE', 'TRANSPORT', 'AUTRE');

-- CreateEnum
CREATE TYPE "ModePaiement" AS ENUM ('ESPECES', 'VIREMENT', 'CHEQUE', 'MOBILE_MONEY', 'CARTE');

-- CreateEnum
CREATE TYPE "TypeAbsence" AS ENUM ('ABSENT', 'RETARD');

-- CreateEnum
CREATE TYPE "StatutAbsenceEleve" AS ENUM ('EN_ATTENTE', 'JUSTIFIEE', 'NON_JUSTIFIEE');

-- CreateEnum
CREATE TYPE "StatutBulletin" AS ENUM ('BROUILLON', 'SOUMIS', 'VALIDE', 'PUBLIE');

-- CreateEnum
CREATE TYPE "StatutDemande" AS ENUM ('EN_ATTENTE', 'APPROUVEE', 'REJETEE');

-- CreateEnum
CREATE TYPE "TypeDocument" AS ENUM ('EXTRAIT_NAISSANCE', 'PHOTO_CNI', 'VISITE_MEDICALE', 'CARNET_SANTE', 'VACCINATION', 'DIPLOME', 'PHOTO', 'AUTRE');

-- CreateEnum
CREATE TYPE "StatutInscription" AS ENUM ('ACTIF', 'INACTIF', 'TRANSFERE', 'EXCLU', 'TERMINE');

-- CreateEnum
CREATE TYPE "StatutAppel" AS ENUM ('BROUILLON', 'SOUMIS', 'VALIDE');

-- CreateEnum
CREATE TYPE "StatutPresence" AS ENUM ('PRESENT', 'ABSENT', 'RETARD');

-- CreateEnum
CREATE TYPE "TypePointage" AS ENUM ('ENTREE', 'SORTIE');

-- CreateEnum
CREATE TYPE "TypeContrat" AS ENUM ('CDI', 'CDD', 'STAGE', 'VACATAIRE', 'BENEVOLE');

-- CreateEnum
CREATE TYPE "TypeAbsencePersonnel" AS ENUM ('MALADIE', 'CONGE', 'SANS_SOLDE', 'AUTRE');

-- CreateEnum
CREATE TYPE "StatutAbsencePersonnel" AS ENUM ('EN_ATTENTE', 'APPROUVEE', 'REJETEE');

-- CreateEnum
CREATE TYPE "StatutReclamation" AS ENUM ('EN_ATTENTE', 'TRAITEE', 'REJETEE');

-- CreateEnum
CREATE TYPE "StatutDemandePassage" AS ENUM ('EN_ATTENTE', 'APPROUVEE', 'REJETEE');

-- CreateEnum
CREATE TYPE "CanalNotification" AS ENUM ('EMAIL', 'SMS', 'WHATSAPP', 'IN_APP');

-- CreateEnum
CREATE TYPE "StatutNotification" AS ENUM ('EN_ATTENTE', 'ENVOYE', 'ECHEC');

-- CreateEnum
CREATE TYPE "TypeSanction" AS ENUM ('AVERTISSEMENT', 'BLAME', 'RETENUE', 'EXCLUSION_COURS', 'EXCLUSION_TEMPORAIRE', 'EXCLUSION_DEFINITIVE', 'TRAVAUX_INTERET_SCOLAIRE', 'CONSEIL_DISCIPLINE');

-- CreateEnum
CREATE TYPE "StatutDiscipline" AS ENUM ('OUVERT', 'EN_TRAITEMENT', 'CLOTURE', 'APPEL', 'ANNULE');

-- CreateEnum
CREATE TYPE "RoleRapporteur" AS ENUM ('ADMIN', 'ENSEIGNANT', 'PROFESSEUR', 'SURVEILLANT', 'ELEVE', 'PERSONNEL', 'PARENT');

-- CreateEnum
CREATE TYPE "StatutAbsenceEnseignant" AS ENUM ('EN_ATTENTE', 'APPROUVEE', 'REJETEE');

-- CreateEnum
CREATE TYPE "StatutProgramme" AS ENUM ('BROUILLON', 'VALIDE', 'EN_COURS', 'TERMINE');

-- CreateEnum
CREATE TYPE "StatutChapitre" AS ENUM ('NON_COMMENCE', 'EN_COURS', 'TERMINE');

-- CreateEnum
CREATE TYPE "TypeEvenementCalendrier" AS ENUM ('RENTREE', 'FIN_ANNEE', 'DEBUT_TRIMESTRE', 'FIN_TRIMESTRE', 'REPRISE_COURS', 'VACANCES', 'JOUR_FERIE', 'PONT', 'DEVOIR_SURVEILLE', 'COMPOSITION', 'EXAMEN_BLANC', 'EXAMEN_OFFICIEL', 'RATTRAPAGE', 'REMISE_COPIES', 'CONSEIL_CLASSE', 'CONSEIL_DISCIPLINE', 'REUNION_PARENTS', 'REUNION_PEDAGOGIQUE', 'ASSEMBLEE_GENERALE', 'JOURNEE_PORTES_OUVERTES', 'JOURNEE_CULTURELLE', 'JOURNEE_SPORTIVE', 'REMISE_PRIX', 'SORTIE_PEDAGOGIQUE', 'SEMAINE_REVISION', 'PUBLICATION_BULLETINS', 'DISTRIBUTION_CARTES', 'DATE_LIMITE_INSCRIPTION', 'DATE_LIMITE_PAIEMENT', 'FORMATION_ENSEIGNANTS', 'AUTRE');

-- CreateEnum
CREATE TYPE "StatutEvenement" AS ENUM ('PLANIFIE', 'CONFIRME', 'ANNULE', 'REPORTE');

-- CreateEnum
CREATE TYPE "VisibiliteEvenement" AS ENUM ('TOUS', 'ADMIN', 'ENSEIGNANTS', 'PARENTS', 'ELEVES', 'SURVEILLANTS', 'CAISSE', 'RH');

-- CreateEnum
CREATE TYPE "StatutDemandeAudit" AS ENUM ('EN_ATTENTE', 'APPROUVEE', 'REJETEE');

-- CreateEnum
CREATE TYPE "SujetIncidentType" AS ENUM ('ELEVE', 'ENSEIGNANT', 'PERSONNEL');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "codeAccesEleve" VARCHAR(16) NOT NULL,
    "codeAccesEnseignant" VARCHAR(16) NOT NULL,
    "codeAccesCaissier" VARCHAR(16) NOT NULL,
    "codeAccesAdmin" VARCHAR(16) NOT NULL,
    "codeAccesSurveillant" VARCHAR(16) NOT NULL,
    "codeAccesRh" VARCHAR(16) NOT NULL,
    "nom" TEXT NOT NULL,
    "emailContact" VARCHAR(254),
    "telephone" VARCHAR(20),
    "adresse" TEXT,
    "logoUrl" TEXT,
    "plan" VARCHAR(50) NOT NULL DEFAULT 'TRIAL',
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "dateExpiration" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FraisNiveauConfig" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "section" VARCHAR(100) NOT NULL,
    "niveau" VARCHAR(100) NOT NULL,
    "inscription" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "mensualite" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "nbMois" INTEGER NOT NULL DEFAULT 9,
    "moisDebut" INTEGER,
    "moisFin" INTEGER,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FraisNiveauConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EcoleConfig" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "nom" VARCHAR(200) NOT NULL,
    "slogan" VARCHAR(300),
    "adresse" VARCHAR(300) NOT NULL,
    "ville" VARCHAR(100) NOT NULL,
    "pays" VARCHAR(5) NOT NULL DEFAULT 'SN',
    "telephone" VARCHAR(25) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "siteWeb" VARCHAR(500),
    "numeroAgrement" VARCHAR(100),
    "typeEtablissement" VARCHAR(20) NOT NULL DEFAULT 'PRIVE',
    "logoUrl" TEXT,
    "logoS3Key" TEXT,
    "cachetUrl" TEXT,
    "cachetS3Key" TEXT,
    "montantHoraireDefaut" DOUBLE PRECISION,
    "themeColor" VARCHAR(20) NOT NULL DEFAULT 'blue',
    "sidebarMode" VARCHAR(10) NOT NULL DEFAULT 'light',
    "displayMode" VARCHAR(10) NOT NULL DEFAULT 'light',
    "primaryColor" VARCHAR(20) NOT NULL DEFAULT '#03a9f3',
    "secondaryColor" VARCHAR(20) NOT NULL DEFAULT '#16a34a',
    "backgroundColor" VARCHAR(20) NOT NULL DEFAULT '#2f7d6f',
    "textColor" VARCHAR(20) NOT NULL DEFAULT '#1f2937',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EcoleConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ecole_palette_configs" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "libelle" VARCHAR(100) NOT NULL,
    "primaryColor" VARCHAR(20) NOT NULL,
    "secondaryColor" VARCHAR(20) NOT NULL,
    "backgroundColor" VARCHAR(20) NOT NULL,
    "textColor" VARCHAR(20) NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ecole_palette_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_sessions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "sessionData" BYTEA,
    "connected" BOOLEAN NOT NULL DEFAULT false,
    "phoneNumber" VARCHAR(25),
    "displayName" VARCHAR(200),
    "connectedAt" TIMESTAMP(3),
    "featureOtp" BOOLEAN NOT NULL DEFAULT false,
    "featurePayment" BOOLEAN NOT NULL DEFAULT false,
    "featureAbsence" BOOLEAN NOT NULL DEFAULT false,
    "featureBulletin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_outbox" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "phone" VARCHAR(30) NOT NULL,
    "message" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlateformeUtilisateur" (
    "id" UUID NOT NULL,
    "nom" VARCHAR(100) NOT NULL,
    "prenom" VARCHAR(100) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "telephone" VARCHAR(20),
    "motDePasse" TEXT NOT NULL,
    "rolePlateforme" "RolePlateforme" NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PlateformeUtilisateur_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "username" VARCHAR(100),
    "email" VARCHAR(254),
    "passwordHash" TEXT NOT NULL,
    "firstName" VARCHAR(100) NOT NULL,
    "lastName" VARCHAR(100) NOT NULL,
    "telephone" VARCHAR(20),
    "numeroIdentificationNational" VARCHAR(10),
    "adresse" TEXT,
    "role" "UserRole" NOT NULL,
    "roles" "UserRole"[] DEFAULT ARRAY[]::"UserRole"[],
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePwd" BOOLEAN NOT NULL DEFAULT true,
    "matricule" VARCHAR(50),
    "dateNaissance" DATE,
    "lieuNaissance" TEXT,
    "genre" "Genre",
    "numeroUrgence" VARCHAR(20),
    "dateInscription" DATE,
    "photoUrl" TEXT,
    "classeId" UUID,
    "specialite" TEXT,
    "dateEmbauche" DATE,
    "numeroCNPS" VARCHAR(50),
    "modeCalculNotes" VARCHAR(20),
    "numeroSecuriteSociale" VARCHAR(50),
    "profession" TEXT,
    "lieuTravail" TEXT,
    "telephoneTravail" VARCHAR(20),
    "lienParente" "LienParente",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eleve_documents" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "eleveId" UUID NOT NULL,
    "type" "TypeDocument" NOT NULL,
    "nom" VARCHAR(300) NOT NULL,
    "fileKey" VARCHAR(1000) NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "taille" INTEGER NOT NULL,
    "uploadedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "eleve_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EleveParent" (
    "eleveId" UUID NOT NULL,
    "parentId" UUID NOT NULL,

    CONSTRAINT "EleveParent_pkey" PRIMARY KEY ("eleveId","parentId")
);

-- CreateTable
CREATE TABLE "Cycle" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "libelle" TEXT NOT NULL,
    "typePeriode" VARCHAR(10) NOT NULL DEFAULT 'TRIMESTRE',
    "moyenneMaximale" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "seeded" BOOLEAN NOT NULL DEFAULT false,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Niveau" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "cycleId" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "libelle" TEXT NOT NULL,
    "ordre" INTEGER NOT NULL,
    "moyennePassage" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "seeded" BOOLEAN NOT NULL DEFAULT false,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Niveau_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnneeAcademique" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "libelle" TEXT NOT NULL,
    "dateDebut" DATE NOT NULL,
    "dateFin" DATE,
    "estCourante" BOOLEAN NOT NULL DEFAULT false,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "classesDupliquees" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnneeAcademique_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Batiment" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "nom" TEXT NOT NULL,
    "description" TEXT,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Batiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Salle" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "batimentId" UUID NOT NULL,
    "nom" TEXT NOT NULL,
    "capacite" INTEGER,
    "typeSalle" VARCHAR(50),
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Salle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Classe" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "nom" TEXT NOT NULL,
    "cycleId" UUID,
    "niveauId" UUID,
    "anneeAcademiqueId" UUID,
    "salleId" UUID,
    "effectifMax" INTEGER,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "professeurResponsableId" UUID,

    CONSTRAINT "Classe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classe_stagiaires" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "classeId" UUID NOT NULL,
    "stagiaireId" UUID NOT NULL,
    "dateDebut" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dateFin" DATE,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classe_stagiaires_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Matiere" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "libelle" TEXT NOT NULL,
    "categorie" TEXT,
    "description" TEXT,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Matiere_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfesseurMatiere" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "professeurId" UUID NOT NULL,
    "matiereId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfesseurMatiere_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatiereClasse" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "matiereId" UUID NOT NULL,
    "classeId" UUID NOT NULL,
    "enseignantId" UUID NOT NULL,
    "anneeAcademiqueId" UUID NOT NULL,
    "anneeScolaire" VARCHAR(10) NOT NULL,
    "volumeHoraire" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatiereClasse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatiereNiveau" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "niveauId" UUID NOT NULL,
    "matiereId" UUID NOT NULL,
    "coefficient" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "noteMaximum" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "volumeHoraireHebdo" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatiereNiveau_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cours" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "matiereId" UUID NOT NULL,
    "classeId" UUID NOT NULL,
    "enseignantId" UUID NOT NULL,
    "anneeAcademiqueId" UUID,
    "volumeHoraireHebdo" INTEGER,
    "montantHoraire" DOUBLE PRECISION,
    "coefficient" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inscription" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "numeroInscription" VARCHAR(50) NOT NULL,
    "eleveId" UUID NOT NULL,
    "classeId" UUID NOT NULL,
    "anneeAcademiqueId" UUID NOT NULL,
    "fraisInscription" DOUBLE PRECISION,
    "statut" "StatutInscription" NOT NULL DEFAULT 'ACTIF',
    "creePar" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Inscription_pkey" PRIMARY KEY ("id")
);

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
CREATE TABLE "Note" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "eleveId" UUID NOT NULL,
    "matiereId" UUID NOT NULL,
    "coursId" UUID,
    "typeEvaluation" "TypeEvaluation" NOT NULL,
    "note" DOUBLE PRECISION NOT NULL,
    "noteSur" DOUBLE PRECISION NOT NULL DEFAULT 20,
    "trimestre" VARCHAR(20) NOT NULL,
    "anneeScolaire" VARCHAR(10) NOT NULL,
    "dateEvaluation" DATE,
    "commentaire" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bulletin" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "eleveId" UUID NOT NULL,
    "classeId" UUID NOT NULL,
    "trimestre" VARCHAR(20) NOT NULL,
    "anneeScolaire" VARCHAR(10) NOT NULL,
    "moyenne" DOUBLE PRECISION,
    "moyenneClasse" DOUBLE PRECISION,
    "rang" INTEGER,
    "totalEleves" INTEGER,
    "appreciation" TEXT,
    "nombreAbsences" INTEGER NOT NULL DEFAULT 0,
    "nombreRetards" INTEGER NOT NULL DEFAULT 0,
    "fichierPdfUrl" TEXT,
    "statut" "StatutBulletin" NOT NULL DEFAULT 'BROUILLON',
    "soumisPar" UUID,
    "validePar" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bulletin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AbsenceEleve" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "eleveId" UUID NOT NULL,
    "classeId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "typeAbsence" "TypeAbsence" NOT NULL DEFAULT 'ABSENT',
    "justifiee" BOOLEAN NOT NULL DEFAULT false,
    "motif" TEXT,
    "documentUrl" TEXT,
    "statut" "StatutAbsenceEleve" NOT NULL DEFAULT 'EN_ATTENTE',
    "approuvePar" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AbsenceEleve_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AbsenceEnseignant" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "enseignantId" UUID NOT NULL,
    "dateDebut" DATE NOT NULL,
    "dateFin" DATE NOT NULL,
    "heureDebut" VARCHAR(5),
    "heureFin" VARCHAR(5),
    "typeAbsence" VARCHAR(20) NOT NULL DEFAULT 'AUTRE',
    "motif" TEXT NOT NULL,
    "statut" "StatutAbsenceEnseignant" NOT NULL DEFAULT 'EN_ATTENTE',
    "justifiee" BOOLEAN NOT NULL DEFAULT false,
    "documentJustificatifUrl" TEXT,
    "remplacantId" UUID,
    "notificationEnvoyee" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AbsenceEnseignant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmploiDuTemps" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "classeId" UUID NOT NULL,
    "coursId" UUID,
    "salleId" UUID,
    "enseignantId" UUID,
    "matiereId" UUID,
    "jourSemaine" VARCHAR(20) NOT NULL,
    "heureDebut" VARCHAR(10) NOT NULL,
    "heureFin" VARCHAR(10) NOT NULL,
    "anneeScolaire" VARCHAR(10),
    "dateDebutValidite" DATE,
    "dateFinValidite" DATE,
    "publie" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmploiDuTemps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PresenceCoursProfesseur" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "coursId" UUID NOT NULL,
    "emploiDuTempsId" UUID,
    "classeId" UUID NOT NULL,
    "enseignantId" UUID NOT NULL,
    "dateCours" DATE NOT NULL,
    "heureDebut" VARCHAR(10) NOT NULL,
    "heureFin" VARCHAR(10) NOT NULL,
    "statut" "StatutPresence" NOT NULL,
    "minutesPlanifiees" INTEGER NOT NULL,
    "minutesComptabilisees" INTEGER NOT NULL,
    "montantHoraire" DOUBLE PRECISION NOT NULL,
    "salaireCalcule" DOUBLE PRECISION NOT NULL,
    "controlePar" UUID NOT NULL,
    "observations" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PresenceCoursProfesseur_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appel" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "coursId" UUID,
    "classeId" UUID,
    "dateCours" DATE NOT NULL,
    "heureDebut" VARCHAR(10),
    "statut" "StatutAppel" NOT NULL DEFAULT 'BROUILLON',
    "soumisPar" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppelLigne" (
    "id" UUID NOT NULL,
    "appelId" UUID NOT NULL,
    "eleveId" UUID NOT NULL,
    "statut" "StatutPresence" NOT NULL DEFAULT 'PRESENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppelLigne_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CahierTexte" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "coursId" UUID NOT NULL,
    "dateCours" DATE NOT NULL,
    "contenuTraite" TEXT NOT NULL,
    "observations" TEXT,
    "etapeProgramme" TEXT,
    "programmeValide" BOOLEAN NOT NULL DEFAULT false,
    "chapitreId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CahierTexte_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserFeatureSeen" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "feature" VARCHAR(50) NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserFeatureSeen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgrammePedagogique" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "niveauId" UUID NOT NULL,
    "matiereId" UUID NOT NULL,
    "anneeAcademiqueId" UUID NOT NULL,
    "titre" TEXT NOT NULL,
    "description" TEXT,
    "statut" "StatutProgramme" NOT NULL DEFAULT 'BROUILLON',
    "valideParCellule" BOOLEAN NOT NULL DEFAULT false,
    "dateValidation" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgrammePedagogique_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChapitreProgamme" (
    "id" UUID NOT NULL,
    "programmeId" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "titre" TEXT NOT NULL,
    "description" TEXT,
    "objectifs" TEXT,
    "competences" TEXT,
    "ressources" TEXT,
    "prerequis" TEXT,
    "periode" VARCHAR(20) NOT NULL,
    "semaineDebut" INTEGER,
    "semaineFin" INTEGER,
    "dateLimite" DATE NOT NULL,
    "volumeHoraire" DOUBLE PRECISION,
    "nbSeances" INTEGER,
    "evaluationPrevue" BOOLEAN NOT NULL DEFAULT false,
    "typeEvaluation" VARCHAR(50),
    "statut" "StatutChapitre" NOT NULL DEFAULT 'NON_COMMENCE',
    "dateDebut" TIMESTAMP(3),
    "dateTermine" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChapitreProgamme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Annonce" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "titre" TEXT NOT NULL,
    "contenu" TEXT NOT NULL,
    "dateDebut" DATE NOT NULL,
    "dateFin" DATE,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Annonce_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communications" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "titre" VARCHAR(200) NOT NULL,
    "contenu" TEXT NOT NULL,
    "canal" VARCHAR(20) NOT NULL DEFAULT 'IN_APP',
    "statut" VARCHAR(20) NOT NULL DEFAULT 'BROUILLON',
    "cibleType" VARCHAR(30) NOT NULL DEFAULT 'ROLES',
    "cible" VARCHAR(40),
    "roles" JSONB,
    "classeIds" JSONB,
    "niveauIds" JSONB,
    "cycleIds" JSONB,
    "utilisateurIds" JSONB,
    "inclureParents" BOOLEAN NOT NULL DEFAULT false,
    "inclureEleves" BOOLEAN NOT NULL DEFAULT true,
    "nbDestinataires" INTEGER NOT NULL DEFAULT 0,
    "nbLus" INTEGER NOT NULL DEFAULT 0,
    "documentUrl" TEXT,
    "documentNom" VARCHAR(300),
    "documentMimeType" VARCHAR(120),
    "documentTaille" INTEGER,
    "datePlanifiee" TIMESTAMP(3),
    "envoyeLe" TIMESTAMP(3),
    "auteurId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "communications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Convocation" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "parentId" UUID NOT NULL,
    "eleveId" UUID NOT NULL,
    "motif" TEXT NOT NULL,
    "type" VARCHAR(40) NOT NULL DEFAULT 'DISCIPLINAIRE',
    "dateConvocation" TIMESTAMP(3) NOT NULL,
    "statut" VARCHAR(20) NOT NULL DEFAULT 'EN_ATTENTE',
    "observations" TEXT,
    "compteRendu" TEXT,
    "creePar" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Convocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "destinataireId" UUID NOT NULL,
    "titre" TEXT NOT NULL,
    "contenu" TEXT,
    "lu" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushToken" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "platform" VARCHAR(40),
    "userAgent" TEXT,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "canal" "CanalNotification" NOT NULL,
    "destinataire" TEXT NOT NULL,
    "sujet" TEXT,
    "contenu" TEXT,
    "statut" "StatutNotification" NOT NULL DEFAULT 'EN_ATTENTE',
    "erreur" TEXT,
    "envoyeLe" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Paiement" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "inscriptionId" UUID,
    "eleveId" UUID NOT NULL,
    "parentId" UUID,
    "reference" VARCHAR(100) NOT NULL,
    "montant" DOUBLE PRECISION NOT NULL,
    "typePaiement" "TypePaiement" NOT NULL,
    "modePaiement" "ModePaiement" NOT NULL,
    "statut" "StatutPaiement" NOT NULL DEFAULT 'EN_ATTENTE',
    "anneeScolaire" VARCHAR(10) NOT NULL,
    "trimestre" VARCHAR(20),
    "transactionId" TEXT,
    "description" TEXT,
    "datePaiement" TIMESTAMP(3),
    "validePar" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Paiement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaiementProfesseur" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "enseignantId" UUID NOT NULL,
    "dateDebut" DATE NOT NULL,
    "dateFin" DATE NOT NULL,
    "heuresEffectuees" DOUBLE PRECISION NOT NULL,
    "heuresDeduites" DOUBLE PRECISION NOT NULL,
    "montant" DOUBLE PRECISION NOT NULL,
    "statut" "StatutPaiement" NOT NULL DEFAULT 'EN_ATTENTE',
    "reference" VARCHAR(80) NOT NULL,
    "initialisePar" UUID,
    "notificationId" UUID,
    "observations" TEXT,
    "motifRejet" TEXT,
    "reponduLe" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaiementProfesseur_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LienPaiementParent" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "parentId" UUID NOT NULL,
    "token" VARCHAR(255) NOT NULL,
    "montantTotal" DOUBLE PRECISION NOT NULL,
    "mois" VARCHAR(7) NOT NULL,
    "statut" VARCHAR(20) NOT NULL DEFAULT 'EN_ATTENTE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "otpHash" TEXT,
    "otpExpiresAt" TIMESTAMP(3),
    "otpVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LienPaiementParent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LienBulletinParent" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "bulletinId" UUID NOT NULL,
    "parentId" UUID NOT NULL,
    "token" VARCHAR(255) NOT NULL,
    "otpHash" TEXT,
    "otpExpiresAt" TIMESTAMP(3),
    "otpVerified" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ouvertLe" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LienBulletinParent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Personnel" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "utilisateurId" UUID NOT NULL,
    "numeroMatricule" VARCHAR(50),
    "typeContrat" "TypeContrat",
    "dateEmbauche" DATE,
    "dureeMois" INTEGER,
    "dateFinContrat" DATE,
    "salaire" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Personnel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonnelNiveauAffectation" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "personnelId" UUID NOT NULL,
    "niveauId" UUID NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "ordre" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonnelNiveauAffectation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pointage" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "personnelId" UUID NOT NULL,
    "typePointage" "TypePointage" NOT NULL DEFAULT 'ENTREE',
    "dateHeure" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date" DATE,
    "statut" VARCHAR(20),
    "heureArrivee" VARCHAR(10),
    "heureDepart" VARCHAR(10),
    "observations" TEXT,
    "methode" VARCHAR(50),
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pointage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AbsencePersonnel" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "personnelId" UUID NOT NULL,
    "userId" UUID,
    "dateDebut" DATE NOT NULL,
    "dateFin" DATE NOT NULL,
    "heureDebut" VARCHAR(10),
    "heureFin" VARCHAR(10),
    "motif" TEXT,
    "typeAbsence" "TypeAbsencePersonnel",
    "justificatifUrl" TEXT,
    "statut" "StatutAbsencePersonnel" NOT NULL DEFAULT 'EN_ATTENTE',
    "validePar" UUID,
    "motifRefus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AbsencePersonnel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurveillantCycle" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "surveillantId" UUID NOT NULL,
    "cycleId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SurveillantCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reclamation" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "eleveId" UUID NOT NULL,
    "noteId" UUID,
    "motif" TEXT NOT NULL,
    "statut" "StatutReclamation" NOT NULL DEFAULT 'EN_ATTENTE',
    "reponse" TEXT,
    "pieceJointeUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reclamation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendrierScolaire" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "sectionId" UUID,
    "titre" TEXT NOT NULL,
    "description" TEXT,
    "dateDebut" DATE NOT NULL,
    "dateFin" DATE,
    "heureDebut" VARCHAR(5),
    "heureFin" VARCHAR(5),
    "type" "TypeEvenementCalendrier" NOT NULL DEFAULT 'AUTRE',
    "statut" "StatutEvenement" NOT NULL DEFAULT 'PLANIFIE',
    "visibilites" "VisibiliteEvenement"[] DEFAULT ARRAY['TOUS']::"VisibiliteEvenement"[],
    "classeId" UUID,
    "niveauId" UUID,
    "couleur" VARCHAR(7),
    "important" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendrierScolaire_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "utilisateurId" UUID,
    "plateformeUserId" UUID,
    "role" VARCHAR(50),
    "action" VARCHAR(100) NOT NULL,
    "resourceType" VARCHAR(100),
    "resourceId" UUID,
    "details" JSONB,
    "ipAddress" VARCHAR(45),
    "userAgent" TEXT,
    "userMatricule" VARCHAR(50),
    "userNomComplet" VARCHAR(200),
    "userEmail" VARCHAR(200),
    "userTelephone" VARCHAR(30),
    "userUsername" VARCHAR(100),
    "deviceType" VARCHAR(50),
    "browserName" VARCHAR(100),
    "osName" VARCHAR(100),
    "geoCity" VARCHAR(100),
    "geoCountry" VARCHAR(100),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemandeAudit" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "demandePar" UUID NOT NULL,
    "motif" TEXT NOT NULL,
    "dateDebut" DATE NOT NULL,
    "dateFin" DATE NOT NULL,
    "filtreActions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "filtreRoles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "filtreUserId" UUID,
    "filtreResources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "statut" "StatutDemandeAudit" NOT NULL DEFAULT 'EN_ATTENTE',
    "traitePar" UUID,
    "commentaire" TEXT,
    "dateTraitement" TIMESTAMP(3),
    "expirationAcces" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DemandeAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemandePassage" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "eleveId" UUID NOT NULL,
    "classeDestId" UUID NOT NULL,
    "anneeAcademiqueId" UUID NOT NULL,
    "motif" TEXT,
    "statut" "StatutDemandePassage" NOT NULL DEFAULT 'EN_ATTENTE',
    "creePar" UUID NOT NULL,
    "traitePar" UUID,
    "motifRefus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DemandePassage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Discipline" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "sujetType" "SujetIncidentType" NOT NULL DEFAULT 'ELEVE',
    "eleveId" UUID,
    "classeId" UUID,
    "enseignantId" UUID,
    "personnelId" UUID,
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

-- CreateIndex: Unique indexes
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");
CREATE UNIQUE INDEX "Tenant_codeAccesEleve_key" ON "Tenant"("codeAccesEleve");
CREATE UNIQUE INDEX "Tenant_codeAccesEnseignant_key" ON "Tenant"("codeAccesEnseignant");
CREATE UNIQUE INDEX "Tenant_codeAccesCaissier_key" ON "Tenant"("codeAccesCaissier");
CREATE UNIQUE INDEX "Tenant_codeAccesAdmin_key" ON "Tenant"("codeAccesAdmin");
CREATE UNIQUE INDEX "Tenant_codeAccesSurveillant_key" ON "Tenant"("codeAccesSurveillant");
CREATE UNIQUE INDEX "Tenant_codeAccesRh_key" ON "Tenant"("codeAccesRh");

CREATE UNIQUE INDEX "FraisNiveauConfig_tenantId_section_niveau_key" ON "FraisNiveauConfig"("tenantId", "section", "niveau");

CREATE UNIQUE INDEX "EcoleConfig_tenantId_key" ON "EcoleConfig"("tenantId");

CREATE UNIQUE INDEX "whatsapp_sessions_tenantId_key" ON "whatsapp_sessions"("tenantId");

CREATE UNIQUE INDEX "PlateformeUtilisateur_email_key" ON "PlateformeUtilisateur"("email");

CREATE UNIQUE INDEX "User_tenantId_email_key" ON "User"("tenantId", "email");
CREATE UNIQUE INDEX "users_tenant_matricule_unique" ON "User"("tenantId", "matricule");

CREATE UNIQUE INDEX "Cycle_tenantId_code_key" ON "Cycle"("tenantId", "code");

CREATE UNIQUE INDEX "Niveau_tenantId_code_key" ON "Niveau"("tenantId", "code");

CREATE UNIQUE INDEX "AnneeAcademique_tenantId_libelle_key" ON "AnneeAcademique"("tenantId", "libelle");

CREATE UNIQUE INDEX "Classe_tenantId_nom_anneeAcademiqueId_key" ON "Classe"("tenantId", "nom", "anneeAcademiqueId");

CREATE UNIQUE INDEX "Matiere_tenantId_code_key" ON "Matiere"("tenantId", "code");

CREATE UNIQUE INDEX "ProfesseurMatiere_professeurId_matiereId_key" ON "ProfesseurMatiere"("professeurId", "matiereId");

CREATE UNIQUE INDEX "MatiereClasse_matiereId_classeId_enseignantId_anneeAcademiqueId_key" ON "MatiereClasse"("matiereId", "classeId", "enseignantId", "anneeAcademiqueId");

CREATE UNIQUE INDEX "MatiereNiveau_tenantId_niveauId_matiereId_key" ON "MatiereNiveau"("tenantId", "niveauId", "matiereId");

CREATE UNIQUE INDEX "Cours_matiereId_enseignantId_classeId_anneeAcademiqueId_key" ON "Cours"("matiereId", "enseignantId", "classeId", "anneeAcademiqueId");

CREATE UNIQUE INDEX "Inscription_numeroInscription_key" ON "Inscription"("numeroInscription");
CREATE UNIQUE INDEX "inscriptions_tenant_eleve_annee_unique" ON "Inscription"("tenantId", "eleveId", "anneeAcademiqueId");

CREATE UNIQUE INDEX "Bulletin_eleveId_classeId_trimestre_anneeScolaire_key" ON "Bulletin"("eleveId", "classeId", "trimestre", "anneeScolaire");

CREATE UNIQUE INDEX "PresenceCoursProfesseur_tenantId_emploiDuTempsId_dateCours_key" ON "PresenceCoursProfesseur"("tenantId", "emploiDuTempsId", "dateCours");

CREATE UNIQUE INDEX "UserFeatureSeen_userId_feature_key" ON "UserFeatureSeen"("userId", "feature");

CREATE UNIQUE INDEX "ProgrammePedagogique_tenantId_niveauId_matiereId_anneeAcademiqueId_key" ON "ProgrammePedagogique"("tenantId", "niveauId", "matiereId", "anneeAcademiqueId");

CREATE UNIQUE INDEX "PushToken_token_key" ON "PushToken"("token");

CREATE UNIQUE INDEX "Paiement_reference_key" ON "Paiement"("reference");

CREATE UNIQUE INDEX "PaiementProfesseur_reference_key" ON "PaiementProfesseur"("reference");

CREATE UNIQUE INDEX "LienPaiementParent_token_key" ON "LienPaiementParent"("token");

CREATE UNIQUE INDEX "LienBulletinParent_token_key" ON "LienBulletinParent"("token");

CREATE UNIQUE INDEX "Personnel_utilisateurId_key" ON "Personnel"("utilisateurId");

CREATE UNIQUE INDEX "PersonnelNiveauAffectation_personnelId_niveauId_type_key" ON "PersonnelNiveauAffectation"("personnelId", "niveauId", "type");
CREATE UNIQUE INDEX "PersonnelNiveauAffectation_niveauId_type_ordre_key" ON "PersonnelNiveauAffectation"("niveauId", "type", "ordre");

CREATE UNIQUE INDEX "SurveillantCycle_surveillantId_cycleId_key" ON "SurveillantCycle"("surveillantId", "cycleId");

CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex: Regular indexes
CREATE INDEX "FraisNiveauConfig_tenantId_idx" ON "FraisNiveauConfig"("tenantId");

CREATE INDEX "ecole_palette_configs_tenantId_actif_idx" ON "ecole_palette_configs"("tenantId", "actif");

CREATE INDEX "whatsapp_outbox_tenantId_createdAt_idx" ON "whatsapp_outbox"("tenantId", "createdAt");
CREATE INDEX "whatsapp_outbox_tenantId_attempts_createdAt_idx" ON "whatsapp_outbox"("tenantId", "attempts", "createdAt");

CREATE INDEX "User_tenantId_role_idx" ON "User"("tenantId", "role");

CREATE INDEX "eleve_documents_tenantId_eleveId_idx" ON "eleve_documents"("tenantId", "eleveId");

CREATE INDEX "Cycle_tenantId_ordre_idx" ON "Cycle"("tenantId", "ordre");

CREATE INDEX "Classe_tenantId_cycleId_idx" ON "Classe"("tenantId", "cycleId");

CREATE INDEX "ProfesseurMatiere_tenantId_matiereId_idx" ON "ProfesseurMatiere"("tenantId", "matiereId");

CREATE INDEX "MatiereNiveau_tenantId_niveauId_idx" ON "MatiereNiveau"("tenantId", "niveauId");

CREATE INDEX "inscriptions_tenantId_statut_idx" ON "Inscription"("tenantId", "statut");
CREATE INDEX "inscriptions_bulletin_batch_idx" ON "Inscription"("tenantId", "classeId", "statut", "anneeAcademiqueId");

CREATE INDEX "DemandeReduction_tenantId_statut_idx" ON "DemandeReduction"("tenantId", "statut");
CREATE INDEX "DemandeReduction_tenantId_eleveId_idx" ON "DemandeReduction"("tenantId", "eleveId");

CREATE INDEX "notes_tenantId_idx" ON "Note"("tenantId");
CREATE INDEX "notes_bulletin_batch_idx" ON "Note"("tenantId", "eleveId", "trimestre", "anneeScolaire");

CREATE INDEX "bulletins_tenantId_statut_idx" ON "Bulletin"("tenantId", "statut");
CREATE INDEX "bulletins_student_visibility_idx" ON "Bulletin"("tenantId", "eleveId", "statut", "anneeScolaire");
CREATE INDEX "bulletins_class_period_idx" ON "Bulletin"("tenantId", "classeId", "trimestre", "anneeScolaire");

CREATE INDEX "absences_eleves_tenantId_statut_createdAt_idx" ON "AbsenceEleve"("tenantId", "statut", "createdAt");
CREATE INDEX "absences_eleves_tenantId_typeAbsence_idx" ON "AbsenceEleve"("tenantId", "typeAbsence");
CREATE INDEX "absences_eleves_bulletin_batch_idx" ON "AbsenceEleve"("tenantId", "eleveId");

CREATE INDEX "PresenceCoursProfesseur_tenantId_dateCours_idx" ON "PresenceCoursProfesseur"("tenantId", "dateCours");
CREATE INDEX "PresenceCoursProfesseur_tenantId_enseignantId_dateCours_idx" ON "PresenceCoursProfesseur"("tenantId", "enseignantId", "dateCours");

CREATE INDEX "UserFeatureSeen_userId_idx" ON "UserFeatureSeen"("userId");

CREATE INDEX "ProgrammePedagogique_tenantId_anneeAcademiqueId_idx" ON "ProgrammePedagogique"("tenantId", "anneeAcademiqueId");

CREATE INDEX "ChapitreProgamme_programmeId_numero_idx" ON "ChapitreProgamme"("programmeId", "numero");

CREATE INDEX "communications_tenantId_statut_createdAt_idx" ON "communications"("tenantId", "statut", "createdAt");
CREATE INDEX "communications_tenantId_canal_idx" ON "communications"("tenantId", "canal");

CREATE INDEX "convocations_tenantId_statut_idx" ON "Convocation"("tenantId", "statut");

CREATE INDEX "notifications_tenantId_destinataireId_lu_createdAt_idx" ON "Notification"("tenantId", "destinataireId", "lu", "createdAt");

CREATE INDEX "PushToken_tenantId_userId_actif_idx" ON "PushToken"("tenantId", "userId", "actif");

CREATE INDEX "paiements_tenantId_statut_createdAt_idx" ON "Paiement"("tenantId", "statut", "createdAt");
CREATE INDEX "paiements_mensualites_batch_idx" ON "Paiement"("eleveId", "typePaiement", "anneeScolaire", "trimestre");

CREATE INDEX "PaiementProfesseur_tenantId_enseignantId_dateDebut_dateFin_idx" ON "PaiementProfesseur"("tenantId", "enseignantId", "dateDebut", "dateFin");
CREATE INDEX "PaiementProfesseur_tenantId_statut_idx" ON "PaiementProfesseur"("tenantId", "statut");

CREATE INDEX "PersonnelNiveauAffectation_tenantId_niveauId_type_idx" ON "PersonnelNiveauAffectation"("tenantId", "niveauId", "type");

CREATE INDEX "CalendrierScolaire_tenantId_sectionId_dateDebut_idx" ON "CalendrierScolaire"("tenantId", "sectionId", "dateDebut");
CREATE INDEX "CalendrierScolaire_tenantId_type_idx" ON "CalendrierScolaire"("tenantId", "type");

CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");
CREATE INDEX "AuditLog_utilisateurId_idx" ON "AuditLog"("utilisateurId");

CREATE INDEX "DemandeAudit_tenantId_statut_idx" ON "DemandeAudit"("tenantId", "statut");

CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

CREATE INDEX "PasswordResetToken_userId_expiresAt_idx" ON "PasswordResetToken"("userId", "expiresAt");

CREATE INDEX "DemandePassage_tenantId_statut_idx" ON "DemandePassage"("tenantId", "statut");
CREATE INDEX "DemandePassage_tenantId_eleveId_idx" ON "DemandePassage"("tenantId", "eleveId");

CREATE INDEX "Discipline_tenantId_statut_idx" ON "Discipline"("tenantId", "statut");
CREATE INDEX "Discipline_tenantId_dateIncident_idx" ON "Discipline"("tenantId", "dateIncident");
CREATE INDEX "Discipline_tenantId_signaleParId_idx" ON "Discipline"("tenantId", "signaleParId");
CREATE INDEX "Discipline_tenantId_sujetType_idx" ON "Discipline"("tenantId", "sujetType");

-- AddForeignKey
ALTER TABLE "FraisNiveauConfig" ADD CONSTRAINT "FraisNiveauConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EcoleConfig" ADD CONSTRAINT "EcoleConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ecole_palette_configs" ADD CONSTRAINT "ecole_palette_configs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_sessions" ADD CONSTRAINT "whatsapp_sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_outbox" ADD CONSTRAINT "whatsapp_outbox_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_classeId_fkey" FOREIGN KEY ("classeId") REFERENCES "Classe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eleve_documents" ADD CONSTRAINT "eleve_documents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eleve_documents" ADD CONSTRAINT "eleve_documents_eleveId_fkey" FOREIGN KEY ("eleveId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EleveParent" ADD CONSTRAINT "EleveParent_eleveId_fkey" FOREIGN KEY ("eleveId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EleveParent" ADD CONSTRAINT "EleveParent_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cycle" ADD CONSTRAINT "Cycle_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Niveau" ADD CONSTRAINT "Niveau_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Niveau" ADD CONSTRAINT "Niveau_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "Cycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnneeAcademique" ADD CONSTRAINT "AnneeAcademique_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batiment" ADD CONSTRAINT "Batiment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Salle" ADD CONSTRAINT "Salle_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Salle" ADD CONSTRAINT "Salle_batimentId_fkey" FOREIGN KEY ("batimentId") REFERENCES "Batiment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Classe" ADD CONSTRAINT "Classe_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Classe" ADD CONSTRAINT "Classe_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "Cycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Classe" ADD CONSTRAINT "Classe_niveauId_fkey" FOREIGN KEY ("niveauId") REFERENCES "Niveau"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Classe" ADD CONSTRAINT "Classe_anneeAcademiqueId_fkey" FOREIGN KEY ("anneeAcademiqueId") REFERENCES "AnneeAcademique"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Classe" ADD CONSTRAINT "Classe_salleId_fkey" FOREIGN KEY ("salleId") REFERENCES "Salle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Classe" ADD CONSTRAINT "Classe_professeurResponsableId_fkey" FOREIGN KEY ("professeurResponsableId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classe_stagiaires" ADD CONSTRAINT "classe_stagiaires_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classe_stagiaires" ADD CONSTRAINT "classe_stagiaires_classeId_fkey" FOREIGN KEY ("classeId") REFERENCES "Classe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classe_stagiaires" ADD CONSTRAINT "classe_stagiaires_stagiaireId_fkey" FOREIGN KEY ("stagiaireId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Matiere" ADD CONSTRAINT "Matiere_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfesseurMatiere" ADD CONSTRAINT "ProfesseurMatiere_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfesseurMatiere" ADD CONSTRAINT "ProfesseurMatiere_professeurId_fkey" FOREIGN KEY ("professeurId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfesseurMatiere" ADD CONSTRAINT "ProfesseurMatiere_matiereId_fkey" FOREIGN KEY ("matiereId") REFERENCES "Matiere"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatiereClasse" ADD CONSTRAINT "MatiereClasse_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatiereClasse" ADD CONSTRAINT "MatiereClasse_matiereId_fkey" FOREIGN KEY ("matiereId") REFERENCES "Matiere"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatiereClasse" ADD CONSTRAINT "MatiereClasse_classeId_fkey" FOREIGN KEY ("classeId") REFERENCES "Classe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatiereClasse" ADD CONSTRAINT "MatiereClasse_enseignantId_fkey" FOREIGN KEY ("enseignantId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatiereClasse" ADD CONSTRAINT "MatiereClasse_anneeAcademiqueId_fkey" FOREIGN KEY ("anneeAcademiqueId") REFERENCES "AnneeAcademique"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatiereNiveau" ADD CONSTRAINT "MatiereNiveau_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatiereNiveau" ADD CONSTRAINT "MatiereNiveau_niveauId_fkey" FOREIGN KEY ("niveauId") REFERENCES "Niveau"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatiereNiveau" ADD CONSTRAINT "MatiereNiveau_matiereId_fkey" FOREIGN KEY ("matiereId") REFERENCES "Matiere"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cours" ADD CONSTRAINT "Cours_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cours" ADD CONSTRAINT "Cours_matiereId_fkey" FOREIGN KEY ("matiereId") REFERENCES "Matiere"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cours" ADD CONSTRAINT "Cours_classeId_fkey" FOREIGN KEY ("classeId") REFERENCES "Classe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cours" ADD CONSTRAINT "Cours_enseignantId_fkey" FOREIGN KEY ("enseignantId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cours" ADD CONSTRAINT "Cours_anneeAcademiqueId_fkey" FOREIGN KEY ("anneeAcademiqueId") REFERENCES "AnneeAcademique"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inscription" ADD CONSTRAINT "Inscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inscription" ADD CONSTRAINT "Inscription_classeId_fkey" FOREIGN KEY ("classeId") REFERENCES "Classe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inscription" ADD CONSTRAINT "Inscription_anneeAcademiqueId_fkey" FOREIGN KEY ("anneeAcademiqueId") REFERENCES "AnneeAcademique"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "Note" ADD CONSTRAINT "Note_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_matiereId_fkey" FOREIGN KEY ("matiereId") REFERENCES "Matiere"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_coursId_fkey" FOREIGN KEY ("coursId") REFERENCES "Cours"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bulletin" ADD CONSTRAINT "Bulletin_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bulletin" ADD CONSTRAINT "Bulletin_classeId_fkey" FOREIGN KEY ("classeId") REFERENCES "Classe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbsenceEleve" ADD CONSTRAINT "AbsenceEleve_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbsenceEleve" ADD CONSTRAINT "AbsenceEleve_classeId_fkey" FOREIGN KEY ("classeId") REFERENCES "Classe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbsenceEnseignant" ADD CONSTRAINT "AbsenceEnseignant_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbsenceEnseignant" ADD CONSTRAINT "AbsenceEnseignant_enseignantId_fkey" FOREIGN KEY ("enseignantId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmploiDuTemps" ADD CONSTRAINT "EmploiDuTemps_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmploiDuTemps" ADD CONSTRAINT "EmploiDuTemps_classeId_fkey" FOREIGN KEY ("classeId") REFERENCES "Classe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmploiDuTemps" ADD CONSTRAINT "EmploiDuTemps_coursId_fkey" FOREIGN KEY ("coursId") REFERENCES "Cours"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmploiDuTemps" ADD CONSTRAINT "EmploiDuTemps_salleId_fkey" FOREIGN KEY ("salleId") REFERENCES "Salle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PresenceCoursProfesseur" ADD CONSTRAINT "PresenceCoursProfesseur_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PresenceCoursProfesseur" ADD CONSTRAINT "PresenceCoursProfesseur_coursId_fkey" FOREIGN KEY ("coursId") REFERENCES "Cours"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PresenceCoursProfesseur" ADD CONSTRAINT "PresenceCoursProfesseur_emploiDuTempsId_fkey" FOREIGN KEY ("emploiDuTempsId") REFERENCES "EmploiDuTemps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PresenceCoursProfesseur" ADD CONSTRAINT "PresenceCoursProfesseur_enseignantId_fkey" FOREIGN KEY ("enseignantId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PresenceCoursProfesseur" ADD CONSTRAINT "PresenceCoursProfesseur_controlePar_fkey" FOREIGN KEY ("controlePar") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appel" ADD CONSTRAINT "Appel_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appel" ADD CONSTRAINT "Appel_coursId_fkey" FOREIGN KEY ("coursId") REFERENCES "Cours"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appel" ADD CONSTRAINT "Appel_classeId_fkey" FOREIGN KEY ("classeId") REFERENCES "Classe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppelLigne" ADD CONSTRAINT "AppelLigne_appelId_fkey" FOREIGN KEY ("appelId") REFERENCES "Appel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CahierTexte" ADD CONSTRAINT "CahierTexte_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CahierTexte" ADD CONSTRAINT "CahierTexte_coursId_fkey" FOREIGN KEY ("coursId") REFERENCES "Cours"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CahierTexte" ADD CONSTRAINT "CahierTexte_chapitreId_fkey" FOREIGN KEY ("chapitreId") REFERENCES "ChapitreProgamme"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgrammePedagogique" ADD CONSTRAINT "ProgrammePedagogique_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgrammePedagogique" ADD CONSTRAINT "ProgrammePedagogique_anneeAcademiqueId_fkey" FOREIGN KEY ("anneeAcademiqueId") REFERENCES "AnneeAcademique"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChapitreProgamme" ADD CONSTRAINT "ChapitreProgamme_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "ProgrammePedagogique"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Annonce" ADD CONSTRAINT "Annonce_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communications" ADD CONSTRAINT "communications_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Convocation" ADD CONSTRAINT "Convocation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushToken" ADD CONSTRAINT "PushToken_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushToken" ADD CONSTRAINT "PushToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Paiement" ADD CONSTRAINT "Paiement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Paiement" ADD CONSTRAINT "Paiement_inscriptionId_fkey" FOREIGN KEY ("inscriptionId") REFERENCES "Inscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaiementProfesseur" ADD CONSTRAINT "PaiementProfesseur_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaiementProfesseur" ADD CONSTRAINT "PaiementProfesseur_enseignantId_fkey" FOREIGN KEY ("enseignantId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaiementProfesseur" ADD CONSTRAINT "PaiementProfesseur_initialisePar_fkey" FOREIGN KEY ("initialisePar") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LienPaiementParent" ADD CONSTRAINT "LienPaiementParent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LienBulletinParent" ADD CONSTRAINT "LienBulletinParent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LienBulletinParent" ADD CONSTRAINT "LienBulletinParent_bulletinId_fkey" FOREIGN KEY ("bulletinId") REFERENCES "Bulletin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Personnel" ADD CONSTRAINT "Personnel_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Personnel" ADD CONSTRAINT "Personnel_utilisateurId_fkey" FOREIGN KEY ("utilisateurId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonnelNiveauAffectation" ADD CONSTRAINT "PersonnelNiveauAffectation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonnelNiveauAffectation" ADD CONSTRAINT "PersonnelNiveauAffectation_personnelId_fkey" FOREIGN KEY ("personnelId") REFERENCES "Personnel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonnelNiveauAffectation" ADD CONSTRAINT "PersonnelNiveauAffectation_niveauId_fkey" FOREIGN KEY ("niveauId") REFERENCES "Niveau"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pointage" ADD CONSTRAINT "Pointage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pointage" ADD CONSTRAINT "Pointage_personnelId_fkey" FOREIGN KEY ("personnelId") REFERENCES "Personnel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbsencePersonnel" ADD CONSTRAINT "AbsencePersonnel_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbsencePersonnel" ADD CONSTRAINT "AbsencePersonnel_personnelId_fkey" FOREIGN KEY ("personnelId") REFERENCES "Personnel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveillantCycle" ADD CONSTRAINT "SurveillantCycle_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveillantCycle" ADD CONSTRAINT "SurveillantCycle_surveillantId_fkey" FOREIGN KEY ("surveillantId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveillantCycle" ADD CONSTRAINT "SurveillantCycle_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "Cycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reclamation" ADD CONSTRAINT "Reclamation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reclamation" ADD CONSTRAINT "Reclamation_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendrierScolaire" ADD CONSTRAINT "CalendrierScolaire_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendrierScolaire" ADD CONSTRAINT "CalendrierScolaire_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "Cycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_utilisateurId_fkey" FOREIGN KEY ("utilisateurId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_plateformeUserId_fkey" FOREIGN KEY ("plateformeUserId") REFERENCES "PlateformeUtilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemandeAudit" ADD CONSTRAINT "DemandeAudit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemandeAudit" ADD CONSTRAINT "DemandeAudit_demandePar_fkey" FOREIGN KEY ("demandePar") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemandePassage" ADD CONSTRAINT "DemandePassage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemandePassage" ADD CONSTRAINT "DemandePassage_eleveId_fkey" FOREIGN KEY ("eleveId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemandePassage" ADD CONSTRAINT "DemandePassage_classeDestId_fkey" FOREIGN KEY ("classeDestId") REFERENCES "Classe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemandePassage" ADD CONSTRAINT "DemandePassage_anneeAcademiqueId_fkey" FOREIGN KEY ("anneeAcademiqueId") REFERENCES "AnneeAcademique"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemandePassage" ADD CONSTRAINT "DemandePassage_creePar_fkey" FOREIGN KEY ("creePar") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemandePassage" ADD CONSTRAINT "DemandePassage_traitePar_fkey" FOREIGN KEY ("traitePar") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Discipline" ADD CONSTRAINT "Discipline_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
