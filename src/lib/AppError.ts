export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(400, message);
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = "Authentication required") {
    super(401, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Not allowed to perform this action") {
    super(403, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super(404, message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message);
  }
}

export class TooManyRequestsError extends AppError {
  // retryAfterSeconds, when known, becomes a Retry-After header (errorHandler).
  constructor(
    message = "Too many requests, please try again later",
    public retryAfterSeconds?: number,
  ) {
    super(429, message);
  }
}

// 403 with its own class name so the frontend can tell "verify your phone"
// apart from an ordinary "not allowed" (errorHandler sends the class name).
export class PhoneNotVerifiedError extends AppError {
  constructor() {
    super(403, "Verify your phone number to continue");
  }
}

// The SMS provider failed or rejected the message (the cause is logged).
export class SmsDeliveryError extends AppError {
  constructor() {
    super(502, "We couldn't send the verification code. Please try again in a moment.");
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = "Service temporarily unavailable") {
    super(503, message);
  }
}
