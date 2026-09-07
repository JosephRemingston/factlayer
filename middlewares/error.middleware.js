import multer from "multer";
import ApiResponse from "../utils/ApiResponse.js";

const errorMiddleware = (error, req, res, next) => {
  console.error(error);
  const statusCode = error instanceof multer.MulterError ? 400 : error.statusCode || 500;
  const message = error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE"
    ? "File size must not exceed 200 MB"
    : error.message || "Internal server error";
  return ApiResponse.error(res, statusCode, message);
};

export default errorMiddleware;