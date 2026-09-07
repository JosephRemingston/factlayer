import mongoose from "mongoose";

const documentSchema = new mongoose.Schema(
  {
    originalFileName: { type: String, required: true, trim: true },
    s3Key: { type: String, required: true, unique: true },
    mimeType: { type: String, required: true, enum: ["application/pdf"] },
    fileSize: { type: Number, required: true },
    status: {
      type: String,
      enum: ["uploaded", "processing", "processed", "failed"],
      default: "uploaded",
      index: true,
    },
    pageCount: { type: Number, default: 0 },
    chunkCount: { type: Number, default: 0 },
    processingError: { type: String, default: null },
  },
  { timestamps: true },
);

const Document = mongoose.model("Document", documentSchema);

export default Document;