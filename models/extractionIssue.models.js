import mongoose from "mongoose";

// Records every extraction or reasoning failure the pipeline detected and how it was handled, so that
// failures are inspectable evidence rather than log lines.
const extractionIssueSchema = new mongoose.Schema(
  {
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: "Document", required: true, index: true },
    chunkId: { type: mongoose.Schema.Types.ObjectId, ref: "Chunk", default: null },
    pageNumber: { type: Number, default: null },
    type: {
      type: String,
      required: true,
      index: true,
      enum: ["ungrounded_evidence", "missing_field", "invalid_confidence", "no_value", "malformed_json", "chunk_failed", "adjudication_failed"],
    },
    message: { type: String, required: true },
    handling: { type: String, required: true },
    candidate: { type: mongoose.Schema.Types.Mixed, default: null },
    outputPreview: { type: String, default: null },
  },
  { timestamps: true },
);

const ExtractionIssue = mongoose.model("ExtractionIssue", extractionIssueSchema);

export default ExtractionIssue;
