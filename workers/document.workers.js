import { Worker } from "bullmq";
import { getRedis } from "../configs/redis.js";
import { DOCUMENT_PROCESSING_QUEUE, PROCESS_DOCUMENT_JOB } from "../utils/constants.js";
import { processDocument } from "../services/document.service.js";

const documentWorker = new Worker(
  DOCUMENT_PROCESSING_QUEUE,
  async (job) => {
    if (job.name !== PROCESS_DOCUMENT_JOB) throw new Error(`Unsupported job: ${job.name}`);
    return processDocument(job.data.documentId);
  },
  { connection: getRedis(), concurrency: 3 },
);

documentWorker.on("completed", (job) => console.log(`Document job ${job.id} completed`));
documentWorker.on("failed", (job, error) => console.error(`Document job ${job?.id} failed:`, error.message));
documentWorker.on("error", (error) => console.error("Document worker error:", error.message));

export default documentWorker;