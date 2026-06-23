import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { Roles } from "@/common/decorators/roles.decorator";
import { CurrentUser } from "@/common/decorators/current-user.decorator";
import type { JwtUser } from "@/common/types/auth.types";
import { DomainService } from "@/modules/domain.service";
import { StorageService } from "@/infrastructure/storage/storage.service";

@Roles("ELEVE")
@Controller("eleve")
export class StudentController {
  constructor(
    private readonly domain: DomainService,
    private readonly storage: StorageService,
  ) {}

  @Get("profil") profil(@CurrentUser() user?: JwtUser) {
    return user ? this.domain.studentProfil(user.sub) : null;
  }
  @Patch("profil") updateProfil(
    @CurrentUser() _user: JwtUser,
    @Body() _body: { telephone?: string },
  ) {
    throw new ForbiddenException(
      "La modification du profil est réservée à l'administrateur. Utilisez la demande de correction.",
    );
  }
  @Get("notes") notes(
    @Headers("x-tenant-id") tenantId: string,
    @CurrentUser() user?: JwtUser,
    @Query("trimestre") trimestre?: string,
  ) {
    return this.domain.studentNotes(tenantId, user?.sub ?? "", trimestre);
  }
  @Get("bulletins") bulletins(
    @Headers("x-tenant-id") tenantId: string,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.domain.studentBulletins(tenantId, user?.sub ?? "");
  }
  @Get("bulletins/:id/export") exportBulletin(
    @Headers("x-tenant-id") tenantId: string,
    @Param("id") id: string,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.domain.studentBulletinExport(tenantId, user?.sub ?? "", id);
  }
  @Get("emploi-du-temps") emploiDuTemps(
    @Headers("x-tenant-id") tenantId: string,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.domain.studentEmploiDuTemps(tenantId, user?.sub ?? "");
  }
  @Get("absences") absences(
    @Headers("x-tenant-id") tenantId: string,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.domain.studentAbsences(tenantId, user?.sub ?? "");
  }
  @Get("notifications") notifications(
    @Headers("x-tenant-id") tenantId: string,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.domain.studentNotifications(tenantId, user?.sub ?? "");
  }
  @Patch("notifications/:id/lire") lireNotification(@Param("id") id: string) {
    return this.domain.studentReadNotification(id);
  }
  @Post("notifications/tout-lire") toutLireNotifications(
    @Headers("x-tenant-id") tenantId: string,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.domain.studentReadAllNotifications(tenantId, user?.sub ?? "");
  }
  /** Upload a justificatif document to MinIO and return the stored URL */
  @Post("reclamations/upload-justificatif")
  async uploadJustificatif(
    @Headers("x-tenant-id") tenantId: string,
    @CurrentUser() user: JwtUser,
    @Req() req: FastifyRequest,
  ) {
    if (!req.isMultipart()) {
      throw new BadRequestException("La requête doit être multipart/form-data");
    }
    const file = await req.file();
    if (!file) throw new BadRequestException("Aucun fichier fourni");

    const allowed = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException(
        "Format non supporté. Utilisez PDF, JPEG, PNG ou WebP.",
      );
    }

    const buffer = await file.toBuffer();
    if (buffer.byteLength > 5 * 1024 * 1024) {
      throw new BadRequestException("Fichier trop volumineux (max 5 Mo).");
    }

    const key = this.storage.buildKey(
      `justificatifs/reclamations/${tenantId}`,
      user.sub,
      file.filename || "justificatif.pdf",
    );
    const stored = await this.storage.upload(key, buffer, file.mimetype);
    const url = stored.startsWith("http")
      ? stored
      : this.storage.buildPublicAccessUrl(stored);
    return { pieceJointeUrl: url };
  }

  @Get("reclamations") reclamations(
    @Headers("x-tenant-id") tenantId: string,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.domain.studentReclamations(tenantId, user?.sub ?? "");
  }
  @Get("reclamations/notes") reclamationNotes(
    @Headers("x-tenant-id") tenantId: string,
    @CurrentUser() user?: JwtUser,
  ) {
    return this.domain.studentReclamationNotes(tenantId, user?.sub ?? "");
  }
  @Post("reclamations") createReclamation(
    @Headers("x-tenant-id") tenantId: string,
    @CurrentUser() user: JwtUser,
    @Body() body: { motif: string; noteId?: string; pieceJointeUrl?: string },
  ) {
    return this.domain.studentCreateReclamation(
      tenantId,
      user.sub,
      body.motif,
      body.noteId,
      body.pieceJointeUrl,
    );
  }
}
