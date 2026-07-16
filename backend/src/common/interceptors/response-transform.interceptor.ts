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
        // If already formatted (has data/meta), pass through
        if (data && data.data !== undefined && data.meta !== undefined) {
          return {
            success: true,
            ...data,
          };
        }

        return {
          success: true,
          data,
        };
      }),
    );
  }
}
