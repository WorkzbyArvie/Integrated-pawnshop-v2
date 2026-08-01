import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '../../prisma.service';
import { AUDIT_ACTION_KEY } from '../decorators/audit-log.decorator';

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditLogInterceptor.name);

  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const action = this.reflector.get<string>(
      AUDIT_ACTION_KEY,
      context.getHandler(),
    );
    if (!action) return next.handle();

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const { method, path, headers } = request;
    const headerPawnshopId = headers?.['pawnshop-id'] as string | undefined;

    return next.handle().pipe(
      tap({
        next: () => {
          this.logAudit(action, user, method, path, true, undefined, headerPawnshopId);
        },
        error: (error) => {
          this.logAudit(action, user, method, path, false, error?.message, headerPawnshopId);
        },
      }),
    );
  }

  private async logAudit(
    action: string,
    user: any,
    method: string,
    path: string,
    success: boolean,
    errorMessage?: string,
    headerPawnshopId?: string,
  ) {
    if (!user?.id) return;
    try {
      await this.prisma.securityLog.create({
        data: {
          profileId: user.id,
          action: `AUDIT:${action}`,
          success,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to write audit log for ${action}: ${(err as Error).message}`,
      );
    }

    let pawnshopId = user.pawnshopId || headerPawnshopId;
    this.logger.log(`[AuditLog] action=${action} user=${user?.id} userPawnshop=${user?.pawnshopId} header=${headerPawnshopId} resolved=${pawnshopId}`);

    if (!pawnshopId) {
      try {
        const profile = await this.prisma.profile.findUnique({
          where: { id: user.id },
          select: { pawnshopId: true },
        });
        pawnshopId = profile?.pawnshopId || null;
        this.logger.log(`[AuditLog] DB fallback pawnshopId=${pawnshopId} for user=${user?.id}`);
      } catch {
        return;
      }
    }
    if (!pawnshopId) {
      this.logger.warn(`[AuditLog] Skipping tenant audit for ${action}: no pawnshopId for user ${user?.id}`);
      return;
    }
    try {
      await this.prisma.$executeRaw`
        INSERT INTO public.tenant_audit_logs
        (id, pawnshop_id, actor_user_id, action, metadata)
        VALUES (
          gen_random_uuid(),
          ${pawnshopId}::uuid,
          ${user.id}::uuid,
          ${action},
          ${JSON.stringify({ method, path, success, error: errorMessage || null })}::jsonb
        )
      `;
    } catch (err) {
      this.logger.warn(
        `Failed to write tenant audit log for ${action}: ${(err as Error).message}`,
      );
    }
  }
}
