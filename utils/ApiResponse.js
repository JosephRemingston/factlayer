class ApiResponse {
  constructor(statusCode, message, data) {
    this.statusCode = statusCode;
    this.message = message;
    this.data = data;
    this.success = statusCode >= 200 && statusCode < 400;
  }
  static success(res, message, data = {}) {
    return res.status(200).json(new ApiResponse(200, message, data));
  }
  static created(res, message, data = {}) {
    return res.status(201).json(new ApiResponse(201, message, data));
  }
  static error(res, statusCode, message, data = {}) {
    return res.status(statusCode).json(new ApiResponse(statusCode, message, data));
  }
  static badRequest(res, message, data = {}) {
    return res.status(400).json(new ApiResponse(400, message, data));
  }
  static unauthorized(res, message = "Unauthorized") {
    return res.status(401).json(new ApiResponse(401, message, ""));
  }
  static forbidden(res, message = "Forbidden") {
    return res.status(403).json(new ApiResponse(403, message, ""));
  }
  static notFound(res, message = "Not found") {
    return res.status(404).json(new ApiResponse(404, message, ""));
  }
}

export default ApiResponse;
