import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { PASSWORD_RULE_KEYS } from '../../security/password-policy.constants';

const SAFE_POLICY_FAILURE_KEYS: ReadonlySet<string> = new Set<string>([
  ...PASSWORD_RULE_KEYS,
  'required',
]);

/**
 * Global exception filter that catches all exceptions and returns a consistent error response.
 * Ensures no stack traces or internal details leak to clients.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number;
    let message: string;
    let errors: any = undefined;
    let errorCode: string | undefined;
    let safeData: Record<string, unknown> | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        const resp = exceptionResponse as any;
        message = resp.message || exception.message;
        if (Array.isArray(resp.message)) {
          message = 'Validation failed';
          errors = resp.message;
        }
        if (typeof resp.error === 'string') {
          errorCode = resp.error;
        }
        if (resp.data && typeof resp.data === 'object' && Array.isArray(resp.data.failed)) {
          const failed = resp.data.failed.filter(
            (key: unknown): key is string =>
              typeof key === 'string' && SAFE_POLICY_FAILURE_KEYS.has(key),
          );
          if (failed.length > 0) safeData = { failed };
        }
      } else {
        message = exception.message;
      }
    } else if (exception instanceof Error) {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = exception.message;

      this.logger.error(
        `Unexpected error: ${exception.message}`,
        exception.stack,
      );
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Unknown error occurred';
      this.logger.error(`Unknown exception: ${JSON.stringify(exception)}`);
    }

    const errorResponse = {
      success: false,
      statusCode: status,
      message,
      ...(errorCode && { error: errorCode }),
      ...(errors && { errors }),
      ...(safeData && { data: safeData }),
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    response.status(status).json(errorResponse);
  }
}
