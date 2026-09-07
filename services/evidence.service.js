import Page from "../models/page.models.js";
import Chunk from "../models/chunk.models.js";

const getDocumentPages = (documentId) => Page.find({ documentId }).sort({ pageNumber: 1 }).lean();

const getDocumentChunks = (documentId) => Chunk.find({ documentId })
  .sort({ pageNumber: 1, chunkIndex: 1 })
  .lean();

const getPageById = (pageId) => Page.findById(pageId).lean();

const getChunkById = (chunkId) => Chunk.findById(chunkId)
  .populate("documentId")
  .populate("pageId")
  .lean();

export { getDocumentPages, getDocumentChunks, getPageById, getChunkById };