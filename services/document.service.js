import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import s3Client from "../configs/s3.js";
import Document from "../models/document.models.js";
import Page from "../models/page.models.js";
import Chunk from "../models/chunk.models.js";
import extractPdfPages from "./pdf.service.js";
import { createChunksForPage } from "./chunk.service.js";
import { deleteChunkVectors, upsertChunkEmbeddings } from "./embedding.service.js";

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

const createDocument = async (file) => {
  const document = new Document({
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
      Body: file.buffer,
      ContentType: "application/pdf",
    }));
    return await document.save();
  } catch (error) {
    await Document.findByIdAndDelete(document._id);
    throw error;
  }
};

const processDocument = async (documentId) => {
  const document = await Document.findById(documentId);
  if (!document) throw new Error("Document not found");
  document.status = "processing";
  document.processingError = null;
  await document.save();

  try {
    const previousChunks = await Chunk.find({ documentId }).select("vectorId").lean();
    await deleteChunkVectors(previousChunks.map((chunk) => chunk.vectorId));
    await Page.deleteMany({ documentId });
    await Chunk.deleteMany({ documentId });
    const pages = await extractPdfPages(await getS3ObjectBuffer(document.s3Key));
    const pageRecords = await Page.insertMany(pages.map((page) => ({ ...page, documentId })));
    const chunkInput = pageRecords.flatMap((page) => createChunksForPage({
      documentId,
      pageId: page._id,
      pageNumber: page.pageNumber,
      text: page.text,
    }));
    const chunkRecords = await Chunk.insertMany(chunkInput.map((chunk) => ({
      ...chunk,
      vectorId: `chunk_${chunk.documentId}_${chunk.pageNumber}_${chunk.chunkIndex}`,
    })));
    await upsertChunkEmbeddings(chunkRecords);
    document.status = "processed";
    document.pageCount = pageRecords.length;
    document.chunkCount = chunkRecords.length;
    document.processingError = null;
    await document.save();
    return document;
  } catch (error) {
    document.status = "failed";
    document.processingError = error.message;
    await document.save();
    throw error;
  }
};

const getDocumentById = async (documentId) => Document.findById(documentId).lean();

export { createDocument, uploadDocumentToS3, getS3ObjectBuffer, processDocument, getDocumentById };