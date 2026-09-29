import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Problem } from '@simorgh/contracts';
import type { FastifyReply } from 'fastify';
import { ApiError } from './api-error.js';

const DEFAULT_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'TOO_MANY_REQUESTS',
};

/** Every error leaves the API as RFC 9457 application/problem+json. */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly log = new Logger('ProblemFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const problem = this.toProblem(exception);
    if (problem.status >= 500) this.log.error(exception);
    void reply.status(problem.status).header('content-type', 'application/problem+json').send(problem);
  }

  private toProblem(exception: unknown): Problem {
    if (exception instanceof ApiError) {
      return {
        type: `https://simorgh.dev/problems/${exception.code.toLowerCase()}`,
        title: exception.message,
        status: exception.getStatus(),
        code: exception.code,
        ...(exception.errors ? { errors: exception.errors } : {}),
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse() as { message?: string | string[] } | string;
      const messages = typeof body === 'string' ? [body] : [body.message ?? exception.message].flat();
      const code = status === 400 ? 'VALIDATION_FAILED' : (DEFAULT_CODES[status] ?? `HTTP_${status}`);
      return {
        type: `https://simorgh.dev/problems/${code.toLowerCase()}`,
        title: status === 400 ? 'Validation failed' : String(messages[0]),
        status,
        code,
        ...(status === 400
          ? {
              errors: messages.map((m) => {
                const [path, ...rest] = String(m).split(': ');
                return rest.length ? { path: path ?? '', message: rest.join(': ') } : { path: '', message: String(m) };
              }),
            }
          : {}),
      };
    }
    // Postgres errors that are the caller's fault rather than ours
    const pgCode = (exception as { code?: string; cause?: { code?: string } })?.cause?.code
      ?? (exception as { code?: string })?.code;
    if (pgCode === '23505') {
      return { type: 'https://simorgh.dev/problems/conflict', title: 'Already exists', status: 409, code: 'CONFLICT' };
    }
    if (pgCode === '42501') {
      return { type: 'https://simorgh.dev/problems/forbidden', title: 'Not allowed', status: 403, code: 'FORBIDDEN' };
    }
    return {
      type: 'https://simorgh.dev/problems/internal',
      title: 'Internal error',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL',
    };
  }
}
