import mongoose from "mongoose";

const pageSchema = new mongoose.Schema(
  {
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: "Document", required: true, index: true },
    pageNumber: { type: Number, required: true },
    text: { type: String, default: "" },
  },
  { timestamps: true },
);

pageSchema.index({ documentId: 1, pageNumber: 1 }, { unique: true });

const Page = mongoose.model("Page", pageSchema);

export default Page;