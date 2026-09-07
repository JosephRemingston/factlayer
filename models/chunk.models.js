import mongoose from "mongoose";

const chunkSchema = new mongoose.Schema(
  {
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: "Document", required: true, index: true },
    pageId: { type: mongoose.Schema.Types.ObjectId, ref: "Page", required: true, index: true },
    pageNumber: { type: Number, required: true },
    chunkIndex: { type: Number, required: true },
    text: { type: String, required: true },
    tokenCount: { type: Number, required: true },
    vectorId: { type: String, required: true, unique: true, index: true },
  },
  { timestamps: true },
);

chunkSchema.index({ documentId: 1, pageNumber: 1, chunkIndex: 1 }, { unique: true });

const Chunk = mongoose.model("Chunk", chunkSchema);

export default Chunk;