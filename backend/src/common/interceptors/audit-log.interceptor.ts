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
    const { method, path } = request;

    return next.handle().pipe(
      tap({
        next: () => {
          this.logAudit(action, user, method, path, true);
        },
        error: (error) => {
          this.logAudit(action, user, method, path, false, error?.message);
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
  }
}
