import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import ApiError from "../utils/ApiError.js";

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, callback) => {
      fs.mkdirSync(path.resolve("uploads"), { recursive: true });
      callback(null, path.resolve("uploads"));
    },
    filename: (req, file, callback) => {
      callback(null, `${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
    },
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    const isPdf = file.mimetype === "application/pdf" && file.originalname.toLowerCase().endsWith(".pdf");
    callback(isPdf ? null : ApiError.badRequest("Only PDF files are allowed"), isPdf);
  },
});

export default upload;