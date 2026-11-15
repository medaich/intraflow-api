import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
  BadRequestException,
} from "@nestjs/common";
import { Request, Response } from "express";

function sanitizeUrl(url?: string): string {
  if (!url) return "";
  return url.replace(/([?&]token=)[^&]+/gi, "$1[REDACTED]");
}

@Catch()
export class GlobalExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const reqId = (request as unknown as { id?: string | number }).id ?? "unknown";
    const isProduction = process.env.NODE_ENV === "production";
    const path = sanitizeUrl(request.originalUrl ?? request.url);

    // Map Multer LIMIT_FILE_SIZE error to 413 Payload Too Large
    const isMulterLimit =
      (exception as { code?: string })?.code === "LIMIT_FILE_SIZE" ||
      ((exception as { name?: string })?.name === "MulterError" &&
        (exception as { code?: string })?.code === "LIMIT_FILE_SIZE") ||
      (exception instanceof BadRequestException &&
        (exception.message === "File too large" ||
          (typeof exception.getResponse() === "object" &&
            exception.getResponse() !== null &&
            (exception.getResponse() as { message?: string }).message ===
              "File too large")));

    if (isMulterLimit) {
      return response.status(HttpStatus.PAYLOAD_TOO_LARGE).json({
        statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
        message: "File size exceeds 10MB limit",
        error: "Payload Too Large",
      });
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();

      if (status >= (HttpStatus.INTERNAL_SERVER_ERROR as number)) {
        this.logger.error({
          reqId,
          method: request.method,
          path,
          status,
          errorName: exception.name,
          message: exception.message,
          ...(isProduction ? {} : { stack: exception.stack }),
        });

        return response.status(status).json({
          statusCode: status,
          message: "Internal server error",
        });
      }

      if (typeof res === "string") {
        return response.status(status).json({
          statusCode: status,
          message: res,
        });
      }

      return response.status(status).json(res);
    }

    // Unhandled / non-Http exceptions (Database errors, unexpected throws)
    const err = exception instanceof Error ? exception : new Error(String(exception));
    this.logger.error({
      reqId,
      method: request.method,
      path,
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      errorName: err.name,
      message: err.message,
      ...(isProduction ? {} : { stack: err.stack }),
    });

    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal server error",
    });
  }
}
