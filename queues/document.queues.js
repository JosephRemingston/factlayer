import { Queue } from "bullmq";
import { getRedis } from "../configs/redis.js";
import { DOCUMENT_PROCESSING_QUEUE, PROCESS_DOCUMENT_JOB } from "../utils/constants.js";

let documentQueue;

const getDocumentQueue = () => {
  if (!documentQueue) {
    documentQueue = new Queue(DOCUMENT_PROCESSING_QUEUE, { connection: getRedis() });
  }
  return documentQueue;
};

const addDocumentProcessingJob = async (documentId) => getDocumentQueue().add(
  PROCESS_DOCUMENT_JOB,
  { documentId: documentId.toString() },
  {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: { age: 3600, count: 100 },
    removeOnFail: { age: 86400, count: 1000 },
  },
);

export { addDocumentProcessingJob, getDocumentQueue };