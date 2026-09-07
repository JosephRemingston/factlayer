import mongoose from "mongoose";

const factSchema = new mongoose.Schema(
  {
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: "Document", required: true, index: true },
    pageId: { type: mongoose.Schema.Types.ObjectId, ref: "Page", required: true, index: true },
    chunkId: { type: mongoose.Schema.Types.ObjectId, ref: "Chunk", required: true, index: true },
    pageNumber: { type: Number, default: null },
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
    // Canonical "subject | predicate | period | scope" string used for embedding-based matching.
    matchText: { type: String, default: null },
    evidenceStart: { type: Number, default: null, min: 0 },
    evidenceEnd: { type: Number, default: null, min: 0 },
    confidence: { type: Number, required: true, min: 0, max: 1 },
    extractionModel: { type: String, required: true, trim: true },
    rawSubject: { type: String, default: null },
    rawPredicate: { type: String, default: null },
    rawValue: { type: mongoose.Schema.Types.Mixed, default: null },
    rawUnit: { type: String, default: null },
    rawCurrency: { type: String, default: null },
    rawPeriod: { type: String, default: null },
    rawScope: { type: String, default: null },
    normalizedSubject: { type: String, default: null, index: true },
    normalizedPredicate: { type: String, default: null, index: true },
    normalizedObject: { type: mongoose.Schema.Types.Mixed, default: null },
    normalizedValue: { type: Number, default: null },
    normalizedPercentage: { type: Number, default: null },
    normalizedUnit: { type: String, default: null },
    normalizedCurrency: { type: String, default: null, index: true },
    normalizedScope: { type: String, default: null },
    periodType: { type: String, default: null },
    normalizedPeriodStart: { type: Date, default: null },
    normalizedPeriodEnd: { type: Date, default: null },
    periodLabel: { type: String, default: null },
  },
  { timestamps: true },
);

factSchema.index({ documentId: 1, chunkId: 1 });

const Fact = mongoose.model("Fact", factSchema);

export default Fact;