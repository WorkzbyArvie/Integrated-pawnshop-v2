import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  Logger,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';

/**
 * Interceptor that logs all incoming requests and their response times.
 * Useful for monitoring and debugging.
 */
@Injectable()
export class RequestLoggerInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, headers } = request;
    const pawnshopId = headers['pawnshop-id'] || 'N/A';
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - start;
          const response = context.switchToHttp().getResponse();
          this.logger.log(
            `${method} ${url} [pawnshop:${pawnshopId}] → ${response.statusCode} (${duration}ms)`,
          );
        },
        error: (error) => {
          const duration = Date.now() - start;
          const statusCode = Number(error?.status || 500);
          const message = `${method} ${url} [pawnshop:${pawnshopId}] → ${statusCode} (${duration}ms) ${error?.message || 'Request failed'}`;

          // 4xx responses are often expected authorization/validation outcomes.
          if (statusCode >= 400 && statusCode < 500) {
            this.logger.warn(message);
            return;
          }

          this.logger.error(message);
        },
      }),
    );
  }
}
