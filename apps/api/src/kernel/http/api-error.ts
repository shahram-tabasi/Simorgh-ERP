import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * An error with a stable machine-readable `code` (architecture §9.2). The
 * message is for people; clients branch on the code.
 */
export class ApiError extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: string,
    message: string,
    readonly errors?: { path: string; message: string }[],
  ) {
    super(message, status);
  }

  static badRequest(code: string, message: string) {
    return new ApiError(HttpStatus.BAD_REQUEST, code, message);
  }
  static unauthorized(code = 'UNAUTHENTICATED', message = 'Authentication required') {
    return new ApiError(HttpStatus.UNAUTHORIZED, code, message);
  }
  static forbidden(code = 'FORBIDDEN', message = 'Not allowed') {
    return new ApiError(HttpStatus.FORBIDDEN, code, message);
  }
  static notFound(code: string, message: string) {
    return new ApiError(HttpStatus.NOT_FOUND, code, message);
  }
  static conflict(code: string, message: string) {
    return new ApiError(HttpStatus.CONFLICT, code, message);
  }
}
