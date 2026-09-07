import mongoose from "mongoose";

const relationshipSchema = new mongoose.Schema(
  {
    factA: { type: mongoose.Schema.Types.ObjectId, ref: "Fact", required: true },
    factB: { type: mongoose.Schema.Types.ObjectId, ref: "Fact", required: true },
    relationshipType: {
      type: String,
      enum: ["candidate", "corroborated", "contradiction", "contextual_difference", "uncertain"],
      default: "candidate",
    },
    similarityScore: { type: Number, required: true, min: 0, max: 1 },
    matchingScore: { type: Number, required: true, min: 0, max: 1 },
    confidence: { type: Number, required: true, min: 0, max: 1 },
    reason: { type: String, required: true },
    context: { type: String, default: null },
    comparisonSignals: { type: mongoose.Schema.Types.Mixed, default: {} },
    evidence: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: { type: String, default: "pending", index: true },
  },
  { timestamps: true },
);

relationshipSchema.index({ factA: 1, factB: 1 }, { unique: true });

const Relationship = mongoose.model("Relationship", relationshipSchema);

export default Relationship;