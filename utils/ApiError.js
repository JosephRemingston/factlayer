class ApiError extends Error {
  constructor(statusCode, message, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.message = message;
    this.details = details;
    this.name = "ApiError";
  }
  static badRequest(message, details) { return new ApiError(400, message, details); }
  static unauthorized(message = "Unauthorized") { return new ApiError(401, message); }
  static forbidden(message = "Forbidden") { return new ApiError(403, message); }
  static notFound(message = "Not found") { return new ApiError(404, message); }
  static conflict(message) { return new ApiError(409, message); }
  static tooManyRequests(message = "Too many requests") { return new ApiError(429, message); }
  static internal(message = "Internal server error") { return new ApiError(500, message); }
}

export default ApiError;
