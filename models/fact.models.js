import mongoose from "mongoose";

const factSchema = new mongoose.Schema(
  {
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: "Document", required: true, index: true },
    pageId: { type: mongoose.Schema.Types.ObjectId, ref: "Page", required: true, index: true },
    chunkId: { type: mongoose.Schema.Types.ObjectId, ref: "Chunk", required: true, index: true },
    subject: { type: String, required: true, trim: true },
    predicate: { type: String, required: true, trim: true },
    object: { type: mongoose.Schema.Types.Mixed, default: null },
    value: { type: mongoose.Schema.Types.Mixed, default: null },
    valueType: { type: String, default: null, trim: true },
    unit: { type: String, default: null, trim: true },
    currency: { type: String, default: null, trim: true },
    period: { type: String, default: null, trim: true },
    periodStart: { type: Date, default: null },
    periodEnd: { type: Date, default: null },
    scope: { type: String, default: null, trim: true },
    sourceText: { type: String, required: true, trim: true },
    evidenceStart: { type: Number, default: null, min: 0 },
    evidenceEnd: { type: Number, default: null, min: 0 },
    confidence: { type: Number, required: true, min: 0, max: 1 },
    extractionModel: { type: String, required: true, trim: true },
  },
  { timestamps: true },
);

factSchema.index({ documentId: 1, chunkId: 1 });

const Fact = mongoose.model("Fact", factSchema);

export default Fact;