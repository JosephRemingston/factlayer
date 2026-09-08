import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import ApiError from "../utils/ApiError.js";

/**
 * Uploads are staged on disk rather than in memory because a PDF may be 200 MB. The project folder is
 * read-only on some hosts, so fall back to the system temp directory instead of failing every upload.
 */
const resolveUploadDir = () => {
  const candidates = [process.env.UPLOAD_DIR, path.resolve("uploads"), path.join(os.tmpdir(), "factlayer-uploads")].filter(Boolean);
  for (const candidate of candidates) {
    try {
      fs.mkdirSync(candidate, { recursive: true });
      fs.accessSync(candidate, fs.constants.W_OK);
      return candidate;
    } catch {
      // try the next location
    }
  }
  throw new Error("No writable directory available for uploads; set UPLOAD_DIR");
};

let uploadDir;

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, callback) => {
      try {
        uploadDir = uploadDir || resolveUploadDir();
        callback(null, uploadDir);
      } catch (error) {
        callback(error);
      }
    },
    filename: (req, file, callback) => {
      callback(null, `${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
    },
  }),
  limits: { fileSize: 200 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, callback) => {
    const isPdf = file.mimetype === "application/pdf" && file.originalname.toLowerCase().endsWith(".pdf");
    callback(isPdf ? null : ApiError.badRequest("Only PDF files are allowed"), isPdf);
  },
});

export default upload;
export { resolveUploadDir };