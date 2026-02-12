export type AppErrorCode =
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "QUEUE_BACKPRESSURE"
  | "QUEUE_CLOSED"
  | "QUEUE_TIMEOUT"
  | "NAVIGATION_ERROR"
  | "INTERNAL_ERROR"
  | "SHUTTING_DOWN";

export class AppError extends Error {
  public readonly code: AppErrorCode;
  public readonly statusCode: number;
  public readonly retryable: boolean;
  public readonly details: Record<string, unknown> | null;

  public constructor(params: {
    code: AppErrorCode;
    message: string;
    statusCode: number;
    retryable?: boolean;
    details?: Record<string, unknown> | null;
  }) {
    super(params.message);
    this.name = "AppError";
    this.code = params.code;
    this.statusCode = params.statusCode;
    this.retryable = params.retryable ?? false;
    this.details = params.details ?? null;
  }
}

export class ValidationError extends AppError {
  public constructor(message: string, details?: Record<string, unknown>) {
    super({
      code: "VALIDATION_ERROR",
      message,
      statusCode: 400,
      retryable: false,
      details: details ?? null,
    });
    this.name = "ValidationError";
  }
}

export class NotFoundError extends AppError {
  public constructor(message: string, details?: Record<string, unknown>) {
    super({
      code: "NOT_FOUND",
      message,
      statusCode: 404,
      retryable: false,
      details: details ?? null,
    });
    this.name = "NotFoundError";
  }
}

export class QueueBackpressureError extends AppError {
  public constructor(details?: Record<string, unknown>) {
    super({
      code: "QUEUE_BACKPRESSURE",
      message: "Request queue is full. Retry later.",
      statusCode: 429,
      retryable: true,
      details: details ?? null,
    });
    this.name = "QueueBackpressureError";
  }
}

export class QueueClosedError extends AppError {
  public constructor(details?: Record<string, unknown>) {
    super({
      code: "QUEUE_CLOSED",
      message: "Request queue is closed and not accepting new tasks.",
      statusCode: 503,
      retryable: true,
      details: details ?? null,
    });
    this.name = "QueueClosedError";
  }
}

export class QueueTimeoutError extends AppError {
  public constructor(details?: Record<string, unknown>) {
    super({
      code: "QUEUE_TIMEOUT",
      message: "Queued task exceeded timeout budget.",
      statusCode: 504,
      retryable: true,
      details: details ?? null,
    });
    this.name = "QueueTimeoutError";
  }
}

export class NavigationError extends AppError {
  public constructor(message: string, details?: Record<string, unknown>) {
    super({
      code: "NAVIGATION_ERROR",
      message,
      statusCode: 502,
      retryable: true,
      details: details ?? null,
    });
    this.name = "NavigationError";
  }
}

export class ShuttingDownError extends AppError {
  public constructor() {
    super({
      code: "SHUTTING_DOWN",
      message: "Service is shutting down. New requests are not accepted.",
      statusCode: 503,
      retryable: true,
      details: null,
    });
    this.name = "ShuttingDownError";
  }
}

export const normalizeError = (error: unknown): AppError => {
  if (error instanceof AppError) return error;
  if (error instanceof Error) {
    return new AppError({
      code: "INTERNAL_ERROR",
      message: error.message,
      statusCode: 500,
      retryable: false,
      details: null,
    });
  }

  return new AppError({
    code: "INTERNAL_ERROR",
    message: "Unknown error.",
    statusCode: 500,
    retryable: false,
    details: null,
  });
};

export const toErrorBody = (error: unknown) => {
  const appError = normalizeError(error);
  return {
    ok: false,
    data: null,
    error: {
      code: appError.code,
      message: appError.message,
      retryable: appError.retryable,
      details: appError.details,
    },
    meta: {
      timestamp: new Date().toISOString(),
      version: "0.1.0",
    },
  };
};
