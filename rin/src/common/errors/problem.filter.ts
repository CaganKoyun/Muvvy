import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

/**
 * Uniform error envelope (RFC 7807 "problem+json" flavour) for every failure,
 * so API consumers get a predictable shape instead of leaking stack traces.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost): void {
    // GraphQL errors are formatted by Apollo, not this HTTP filter.
    if (host.getType() !== 'http') {
      throw exception;
    }
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    const req = ctx.getRequest();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    let title = 'Internal Server Error';
    let detail: string | undefined;
    let errors: unknown;

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      if (typeof body === 'string') {
        title = body;
      } else if (body && typeof body === 'object') {
        const b = body as Record<string, unknown>;
        title = (b.error as string) ?? exception.name;
        detail = Array.isArray(b.message)
          ? undefined
          : (b.message as string | undefined);
        if (Array.isArray(b.message)) errors = b.message;
      }
    } else {
      this.logger.error(
        `Unhandled: ${(exception as Error)?.message}`,
        (exception as Error)?.stack,
      );
    }

    res.status(status).json({
      type: 'about:blank',
      title,
      status,
      detail,
      errors,
      instance: req.originalUrl ?? req.url,
      timestamp: new Date().toISOString(),
    });
  }
}
