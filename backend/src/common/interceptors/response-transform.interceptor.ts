import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';

/**
 * Interceptor that wraps all successful responses in a consistent format.
 */
@Injectable()
export class ResponseTransformInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map((data) => {
        if (data && typeof data === 'object' && !Array.isArray(data)) {
          const envelope = data as Record<string, unknown>;

          // Already shaped as an envelope: pass through untouched, whether it
          // reports success or failure. Re-wrapping a deliberate failure
          // envelope would report it as a success.
          if (typeof envelope.success === 'boolean') {
            return data;
          }

          // Carries pagination or tracing meta alongside data: keep both.
          if (envelope.data !== undefined && envelope.meta !== undefined) {
            return {
              success: true,
              ...envelope,
            };
          }
        }

        return {
          success: true,
          data,
        };
      }),
    );
  }
}
