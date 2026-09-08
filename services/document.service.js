import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import fsPromises from "node:fs/promises";
import s3Client from "../configs/s3.js";
import Document from "../models/document.models.js";
import Page from "../models/page.models.js";
import Chunk from "../models/chunk.models.js";
import Fact from "../models/fact.models.js";
import ExtractionIssue from "../models/extractionIssue.models.js";
import extractPdfPages from "./pdf.service.js";
import { createChunksForPage } from "./chunk.service.js";
import { detectPrimaryEntity, extractFactsFromChunk } from "./extraction.service.js";
import { buildFactMatchText, normalizeFact } from "./normalization.service.js";
import { createCandidateRelationships, deleteRelationshipsForFacts } from "./comparison.service.js";
import { reconcileRelationships } from "./reconciliation.service.js";
import {
  deleteChunkVectors,
  deleteFactVectors,
  upsertChunkEmbeddings,
  upsertFactEmbeddings,
} from "./embedding.service.js";
import os from "node:os";
import crypto from "node:crypto";
import { createLimiter, mapWithConcurrency } from "../utils/concurrency.js";
import { DEFAULT_OWNER, MIN_EXTRACTION_CHARACTERS, PROCESSING_LEASE_MS, PROCESSING_HEARTBEAT_MS } from "../utils/constants.js";

// Identifies this server process so that a document is processed by one instance at a time.
const INSTANCE_ID = `${os.hostname()}:${process.pid}:${crypto.randomBytes(3).toString("hex")}`;
const staleBefore = () => new Date(Date.now() - PROCESSING_LEASE_MS);

// Atomically takes the lease when nobody holds it, we already hold it, or the holder's heartbeat is stale.
const acquireLease = async (documentId) => Document.findOneAndUpdate(
  {
    _id: documentId,
    $or: [{ processingOwner: null }, { processingOwner: INSTANCE_ID }, { processingHeartbeat: { $lt: staleBefore() } }, { processingHeartbeat: null }],
  },
  { $set: { processingOwner: INSTANCE_ID, processingHeartbeat: new Date() } },
  { new: true },
);

const releaseLease = (documentId) => Document.updateOne(
  { _id: documentId, processingOwner: INSTANCE_ID },
  { $set: { processingOwner: null, processingHeartbeat: null } },
);

const startHeartbeat = (documentId) => setInterval(() => {
  Document.updateOne({ _id: documentId, processingOwner: INSTANCE_ID }, { $set: { processingHeartbeat: new Date() } })
    .catch((error) => console.warn(`Document ${documentId}: heartbeat failed: ${error.message}`));
}, PROCESSING_HEARTBEAT_MS);

const isLockedElsewhere = (document) => Boolean(document?.processingOwner)
  && document.processingOwner !== INSTANCE_ID
  && document.processingHeartbeat
  && new Date(document.processingHeartbeat) >= staleBefore();

const bucket = () => {
  if (!process.env.AWS_BUCKET_NAME) throw new Error("AWS_BUCKET_NAME is required");
  return process.env.AWS_BUCKET_NAME;
};

const streamToBuffer = async (stream) => {
  const parts = [];
  for await (const part of stream) parts.push(part);
  return Buffer.concat(parts);
};

const uploadDocumentToS3 = async (document, buffer) => {
  const s3Key = `documents/${document._id.toString()}/original.pdf`;
  await s3Client.send(new PutObjectCommand({ Bucket: bucket(), Key: s3Key, Body: buffer, ContentType: "application/pdf" }));
  document.s3Key = s3Key;
  return document.save();
};

const getS3ObjectBuffer = async (s3Key) => {
  const response = await s3Client.send(new GetObjectCommand({ Bucket: bucket(), Key: s3Key }));
  return streamToBuffer(response.Body);
};

// Stores the PDF in S3 and records it; the bytes are returned so the first processing run can start
// immediately without a round trip back to S3.
const createDocument = async (file, owner = DEFAULT_OWNER) => {
  const buffer = file.buffer || await fsPromises.readFile(file.path);
  const document = new Document({
    owner,
    originalFileName: file.originalname,
    s3Key: "pending",
    mimeType: file.mimetype,
    fileSize: file.size,
  });
  document.s3Key = `documents/${document._id.toString()}/original.pdf`;
  try {
    await s3Client.send(new PutObjectCommand({
      Bucket: bucket(),
      Key: document.s3Key,
      Body: buffer,
      ContentLength: buffer.length,
      ContentType: "application/pdf",
    }));
    await document.save();
    return { document, buffer };
  } catch (error) {
    await Document.findByIdAndDelete(document._id);
    await s3Client.send(new DeleteObjectCommand({ Bucket: bucket(), Key: document.s3Key })).catch(() => {});
    throw error;
  } finally {
    if (file.path) await fsPromises.unlink(file.path).catch(() => {});
  }
};

// Removes everything derived from a document (vectors, relationships, facts, chunks, pages).
const clearDerivedData = async (documentId, owner) => {
  await Document.updateOne({ _id: documentId }, { $set: { chunksEmbedded: false } });
  const previousChunks = await Chunk.find({ documentId }).select("vectorId").lean();
  const previousFacts = await Fact.find({ documentId }).select("_id").lean();
  await deleteChunkVectors(previousChunks.map((chunk) => chunk.vectorId), owner);
  await deleteFactVectors(previousFacts.map((fact) => fact._id), owner);
  await deleteRelationshipsForFacts(previousFacts.map((fact) => fact._id));
  await Fact.deleteMany({ documentId });
  await ExtractionIssue.deleteMany({ documentId });
  await Page.deleteMany({ documentId });
  await Chunk.deleteMany({ documentId });
};

const recordIssues = async (documentId, chunk, issues, owner) => {
  if (!issues.length) return;
  await ExtractionIssue.insertMany(issues.map((issue) => ({
    owner,
    documentId,
    chunkId: chunk._id,
    pageNumber: chunk.pageNumber ?? null,
    type: issue.type,
    message: issue.message,
    handling: issue.handling,
    candidate: issue.candidate ?? null,
    outputPreview: issue.outputPreview ?? null,
  })));
};

// Boilerplate pages (covers, separators, blank tables of contents) are not worth a model call.
const isTrivialChunk = (text) => text.length < MIN_EXTRACTION_CHARACTERS && !/\d/.test(text);

const setStage = async (document, stage) => {
  document.processingStage = stage;
  await document.save();
  console.log(`Document ${document._id}: ${stage}`);
};

// Chunk vectors are only marked done after a successful upsert, so an interrupted or failed
// embedding stage is redone on the next run instead of leaving the document unsearchable.
const embedChunks = async (document, chunkRecords) => {
  await setStage(document, "embedding chunks");
  await upsertChunkEmbeddings(chunkRecords.filter((chunk) => chunk.extractionStatus !== "skipped"), document.owner);
  document.chunksEmbedded = true;
  await document.save();
};

const parseAndChunk = async (document, pdfBuffer) => {
  const documentId = document._id;
  await setStage(document, "parsing PDF");
  const pages = await extractPdfPages(pdfBuffer);
  const pageRecords = await Page.insertMany(pages.map((page) => ({ ...page, documentId })));
  const chunkInput = pageRecords.flatMap((page) => createChunksForPage({
    documentId,
    pageId: page._id,
    pageNumber: page.pageNumber,
    text: page.text,
  }));
  const chunkRecords = await Chunk.insertMany(chunkInput.map((chunk) => ({
    ...chunk,
    owner: document.owner,
    vectorId: `chunk_${chunk.documentId}_${chunk.pageNumber}_${chunk.chunkIndex}`,
    extractionStatus: isTrivialChunk(chunk.text) ? "skipped" : "pending",
  })));
  document.pageCount = pageRecords.length;
  document.chunkCount = chunkRecords.length;
  document.processedChunkCount = chunkRecords.filter((chunk) => chunk.extractionStatus === "skipped").length;
  await embedChunks(document, chunkRecords);
  return { pageRecords, chunkRecords };
};

// Runs the full pipeline. It is resumable: pages and chunks already stored are reused, and only chunks
// whose extraction has not completed are sent to the model, so a retry never repeats finished work.
const processDocument = async (documentId, { buffer = null, reset = false } = {}) => {
  const leased = await acquireLease(documentId);
  if (!leased) {
    const current = await Document.findById(documentId).select("processingOwner").lean();
    if (!current) throw new Error("Document not found");
    console.log(`Document ${documentId}: skipped, being processed by ${current.processingOwner}`);
    return current;
  }
  const document = await Document.findById(documentId);
  document.status = "processing";
  document.processingError = null;
  document.processingStartedAt = new Date();
  document.processingFinishedAt = null;
  await document.save();
  const heartbeat = startHeartbeat(documentId);

  try {
    if (reset) await clearDerivedData(documentId, document.owner);
    let pageRecords = await Page.find({ documentId }).sort({ pageNumber: 1 }).lean();
    let chunkRecords;
    if (!pageRecords.length) {
      const pdfBuffer = buffer || await getS3ObjectBuffer(document.s3Key);
      ({ pageRecords, chunkRecords } = await parseAndChunk(document, pdfBuffer));
    } else {
      chunkRecords = await Chunk.find({ documentId }).sort({ pageNumber: 1, chunkIndex: 1 }).lean();
      document.pageCount = pageRecords.length;
      document.chunkCount = chunkRecords.length;
      if (!document.chunksEmbedded) await embedChunks(document, chunkRecords);
    }

    if (!document.primaryEntity) {
      await setStage(document, "identifying primary entity");
      const openingText = pageRecords.slice(0, 3).map((page) => page.text).join("\n\n");
      document.primaryEntity = await detectPrimaryEntity(openingText).catch((error) => {
        console.warn(`Document ${documentId}: primary entity detection failed: ${error.message}`);
        return null;
      });
      if (document.primaryEntity) console.log(`Document ${documentId}: primary entity "${document.primaryEntity}"`);
    }

    const pendingChunks = chunkRecords.filter((chunk) => chunk.extractionStatus === "pending" || chunk.extractionStatus === "failed");
    document.processedChunkCount = chunkRecords.length - pendingChunks.length;
    await setStage(document, `extracting facts from ${pendingChunks.length} of ${chunkRecords.length} chunks`);
    const failedChunks = [];
    let completed = 0;
    const concurrency = Number(process.env.EXTRACTION_CONCURRENCY || 8);
    await mapWithConcurrency(pendingChunks, concurrency, async (chunk) => {
      // Every rejected candidate or repaired reply is kept as evidence of how failures were handled.
      const issues = [];
      const context = { primaryEntity: document.primaryEntity, onIssue: (issue) => issues.push(issue) };
      try {
        const facts = await extractFactsFromChunk(chunk, null, context);
        const normalized = facts.map(normalizeFact).map((fact) => ({ ...fact, owner: document.owner, matchText: buildFactMatchText(fact) }));
        // Persist per chunk so an interrupted run resumes instead of restarting; replace any partial prior write.
        await Fact.deleteMany({ chunkId: chunk._id });
        await ExtractionIssue.deleteMany({ chunkId: chunk._id });
        if (normalized.length) await Fact.insertMany(normalized);
        await recordIssues(documentId, chunk, issues, document.owner);
        await Chunk.updateOne({ _id: chunk._id }, { $set: { extractionStatus: "done", factCount: normalized.length } });
      } catch (error) {
        failedChunks.push(chunk._id.toString());
        await Chunk.updateOne({ _id: chunk._id }, { $set: { extractionStatus: "failed", factCount: 0 } });
        const message = String(error.message).split("\n")[0];
        console.warn(`Document ${documentId}: extraction failed for chunk ${chunk._id} (page ${chunk.pageNumber}): ${message}`);
        await ExtractionIssue.deleteMany({ chunkId: chunk._id });
        await recordIssues(documentId, chunk, [...issues, { type: "chunk_failed", message, handling: "Skipped this page after retries and continued with the rest of the document." }], document.owner).catch(() => {});
      }
      completed += 1;
      const processedChunkCount = chunkRecords.length - pendingChunks.length + completed;
      if (completed % 10 === 0 || completed === pendingChunks.length) {
        const factCount = await Fact.countDocuments({ documentId });
        await Document.updateOne({ _id: documentId }, { $set: { processedChunkCount, factCount } });
        console.log(`Document ${documentId}: ${processedChunkCount}/${chunkRecords.length} chunks, ${factCount} facts (${failedChunks.length} chunks failed)`);
      }
    });
    if (pendingChunks.length && failedChunks.length === pendingChunks.length) {
      throw new Error(`Fact extraction failed for all ${pendingChunks.length} pending chunks`);
    }

    const factRecords = await Fact.find({ documentId }).lean();
    await setStage(document, `embedding facts 0/${factRecords.length}`);
    // Stage strings carry "done/total" so the API can report a moving percentage inside long stages.
    const stageProgress = (label) => (done, total, note) => Document.updateOne(
      { _id: documentId },
      { $set: { processingStage: note ? `${label} ${done}/${total}, ${note}` : `${label} ${done}/${total}` } },
    );
    const factVectors = await upsertFactEmbeddings(factRecords, stageProgress("embedding facts"), document.owner);
    await setStage(document, `matching facts 0/${factRecords.length}`);
    await deleteRelationshipsForFacts(factRecords.map((fact) => fact._id));
    const candidateRelationships = await createCandidateRelationships(factRecords, undefined, factVectors, undefined, stageProgress("matching facts"), document.owner);
    const reconciled = await reconcileRelationships(candidateRelationships);
    document.status = "processed";
    document.processingStage = null;
    document.processedChunkCount = chunkRecords.length;
    document.factCount = factRecords.length;
    document.relationshipCount = reconciled.length;
    document.extractionIssueCount = await ExtractionIssue.countDocuments({ documentId });
    document.processingError = failedChunks.length ? `Fact extraction skipped ${failedChunks.length} of ${chunkRecords.length} chunks` : null;
    document.processingFinishedAt = new Date();
    await document.save();
    console.log(`Document ${documentId}: processed with ${factRecords.length} facts and ${reconciled.length} relationships`);
    return document;
  } catch (error) {
    document.status = "failed";
    document.processingStage = null;
    document.processingError = error.message;
    document.processingFinishedAt = new Date();
    await document.save();
    throw error;
  } finally {
    clearInterval(heartbeat);
    await releaseLease(documentId).catch(() => {});
  }
};

// In-process scheduling: PROCESSING_CONCURRENCY documents run at once, the rest wait in order.
const processingLimiter = createLimiter(Number(process.env.PROCESSING_CONCURRENCY || 2));
const inFlight = new Map();

const startDocumentProcessing = (documentId, options = {}) => {
  const id = documentId.toString();
  if (inFlight.has(id)) return inFlight.get(id);
  // Only mark as queued when no other live instance holds the lease; the lease itself is taken when a slot frees.
  const run = Document.updateOne(
    { _id: id, $or: [{ processingOwner: null }, { processingOwner: INSTANCE_ID }, { processingHeartbeat: { $lt: staleBefore() } }, { processingHeartbeat: null }] },
    { $set: { status: "processing", processingStage: "waiting for a processing slot", processingError: null } },
  )
    .then(() => processingLimiter.run(() => processDocument(id, options)))
    .catch((error) => console.error(`Document ${id} processing failed: ${error.message}`))
    .finally(() => inFlight.delete(id));
  inFlight.set(id, run);
  return run;
};

const isProcessingInFlight = (documentId) => inFlight.has(documentId.toString());

// True when this or another live instance is currently processing the document.
const isDocumentBusy = (document) => isProcessingInFlight(document._id) || isLockedElsewhere(document);

// Documents left "processing" (or "uploaded" but never started) by a previous server run resume
// from their last completed chunk.
const resumeInterruptedDocuments = async () => {
  const interrupted = await Document.find({
    status: { $in: ["processing", "uploaded"] },
    $or: [{ processingOwner: null }, { processingHeartbeat: null }, { processingHeartbeat: { $lt: staleBefore() } }],
  }).sort({ createdAt: 1 }).select("_id").lean();
  for (const { _id } of interrupted) {
    console.log(`Resuming interrupted document ${_id}`);
    startDocumentProcessing(_id);
  }
  return interrupted.length;
};

// Progress summary for API responses. Extraction dominates the pipeline, so it owns most of the
// percentage range; the other stages get fixed slices so the bar never sits still or moves backwards.
const STAGE_RANGES = [
  [/waiting/i, 0, 2, "queued"],
  [/parsing/i, 2, 6, "parsing"],
  [/embedding chunks/i, 6, 12, "embedding"],
  [/primary entity/i, 12, 14, "identifying"],
  [/extracting/i, 14, 86, "extracting"],
  [/embedding facts/i, 86, 91, "embedding facts"],
  [/matching/i, 91, 99, "matching"],
];

// "label done/total" inside a stage string gives the fraction of that stage that is complete.
const stageFraction = (stage) => {
  const match = String(stage || "").match(/(\d+)\/(\d+)/);
  if (!match || Number(match[2]) === 0) return null;
  return Math.min(1, Number(match[1]) / Number(match[2]));
};

const buildProgress = (document) => {
  if (!document) return null;
  const total = document.chunkCount || 0;
  const processed = Math.min(document.processedChunkCount || 0, total);
  const startedAt = document.processingStartedAt ? new Date(document.processingStartedAt) : null;
  const finishedAt = document.processingFinishedAt ? new Date(document.processingFinishedAt) : null;
  const elapsedSeconds = startedAt ? Math.max(0, Math.round(((finishedAt || new Date()) - startedAt) / 1000)) : null;
  let percent = 0;
  let stageKey = "queued";
  if (document.status === "processed") {
    percent = 100;
    stageKey = "done";
  } else if (document.status === "failed") {
    stageKey = "failed";
    percent = total ? Math.round((processed / total) * 86) : 0;
  } else if (document.status === "processing") {
    const range = STAGE_RANGES.find(([pattern]) => pattern.test(document.processingStage || ""));
    if (range) {
      const [, from, to, key] = range;
      stageKey = key;
      const fraction = key === "extracting" && total ? processed / total : (stageFraction(document.processingStage) ?? 0);
      percent = Math.round(from + (to - from) * fraction);
    } else {
      stageKey = "processing";
      percent = 2;
    }
  }
  // Rough time remaining, based on the extraction rate observed so far.
  let etaSeconds = null;
  if (stageKey === "extracting" && startedAt && processed > 0 && total > processed) {
    const perChunk = ((new Date()) - startedAt) / 1000 / processed;
    etaSeconds = Math.round(perChunk * (total - processed));
  }
  return {
    percent,
    stageKey,
    stage: document.status === "processed" ? "Processed" : document.status === "failed" ? "Failed" : (document.processingStage || "Queued"),
    processedChunks: processed,
    totalChunks: total,
    remainingChunks: Math.max(0, total - processed),
    facts: document.factCount || 0,
    relationships: document.relationshipCount || 0,
    elapsedSeconds,
    etaSeconds,
  };
};

const withProgress = (document) => (document ? { ...document, progress: buildProgress(document) } : document);

const getDocumentById = async (documentId, owner) => withProgress(await Document.findOne({ _id: documentId, ...(owner ? { owner } : {}) }).lean());

const listDocuments = async (owner) => (await Document.find(owner ? { owner } : {}).sort({ createdAt: -1 }).lean()).map(withProgress);

const markDocumentFailed = async (documentId, message) => Document.findOneAndUpdate(
  { _id: documentId, status: { $ne: "processed" } },
  { $set: { status: "failed", processingError: message, processingStage: null } },
);

export {
  createDocument,
  uploadDocumentToS3,
  getS3ObjectBuffer,
  processDocument,
  startDocumentProcessing,
  isProcessingInFlight,
  isDocumentBusy,
  resumeInterruptedDocuments,
  clearDerivedData,
  getDocumentById,
  listDocuments,
  buildProgress,
  withProgress,
  markDocumentFailed,
};
