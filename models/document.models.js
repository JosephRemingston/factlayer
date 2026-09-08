import mongoose from "mongoose";

const documentSchema = new mongoose.Schema(
  {
    // Workspace this record belongs to; every read is scoped by it.
    owner: { type: String, required: true, default: "demo", index: true },
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
    processedChunkCount: { type: Number, default: 0 },
    factCount: { type: Number, default: 0 },
    relationshipCount: { type: Number, default: 0 },
    extractionIssueCount: { type: Number, default: 0 },
    // False until chunk vectors are in the index, so a resume after a failed embedding stage redoes it.
    chunksEmbedded: { type: Boolean, default: false },
    primaryEntity: { type: String, default: null },
    processingStage: { type: String, default: null },
    processingStartedAt: { type: Date, default: null },
    processingFinishedAt: { type: Date, default: null },
    // Lease held by the server instance currently processing the document; stale heartbeats can be taken over.
    processingOwner: { type: String, default: null },
    processingHeartbeat: { type: Date, default: null },
    processingError: { type: String, default: null },
  },
  { timestamps: true },
);

const Document = mongoose.model("Document", documentSchema);

export default Document;