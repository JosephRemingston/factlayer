import mongoose from "mongoose";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import Fact from "../models/fact.models.js";
import Relationship from "../models/relationship.models.js";

const factSourcePopulation = [
  { path: "documentId" },
  { path: "pageId" },
  { path: "chunkId" },
];

const relationshipFactPopulation = [
  { path: "factA", populate: factSourcePopulation },
  { path: "factB", populate: factSourcePopulation },
];

const getDocumentRelationships = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.documentId)) throw ApiError.badRequest("Invalid document ID");
  const facts = await Fact.find({ documentId: req.params.documentId }).select("_id").lean();
  const factIds = facts.map((fact) => fact._id);
  const relationships = factIds.length
    ? await Relationship.find({ $or: [{ factA: { $in: factIds } }, { factB: { $in: factIds } }] })
      .populate(relationshipFactPopulation)
      .sort({ createdAt: 1 })
      .lean()
    : [];
  return ApiResponse.success(res, "Document relationships retrieved successfully", { relationships });
};

const getRelationship = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.relationshipId)) throw ApiError.badRequest("Invalid relationship ID");
  const relationship = await Relationship.findById(req.params.relationshipId)
    .populate(relationshipFactPopulation)
    .lean();
  if (!relationship) throw ApiError.notFound("Relationship not found");
  return ApiResponse.success(res, "Relationship retrieved successfully", {
    relationship,
    factA: relationship.factA,
    factB: relationship.factB,
    similarity: relationship.similarityScore,
    reason: relationship.reason,
  });
};

export { getDocumentRelationships, getRelationship };