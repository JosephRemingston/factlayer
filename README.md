# FactLayer

FactLayer Part 1 is the document ingestion foundation for an evidence-grounded knowledge system. It stores the original PDF in private AWS S3, keeps canonical document/page/chunk data in MongoDB, processes asynchronously with Redis and BullMQ, and stores chunk embeddings in Pinecone for future semantic retrieval.

Part 2 extends that pipeline with validated, evidence-grounded LLM fact extraction and fact-level Pinecone embeddings.

## Scope

Part 1 implements:

```text
PDF
  |
Express upload controller
  |-- MongoDB document metadata
  |-- private AWS S3 original PDF
  `-- BullMQ document-processing job
          |
        Redis
          |
        Worker
          |
          PDF parser -> Pages -> Chunks
                     |         |
                   MongoDB   Embeddings -> Pinecone (chunks)
                            |
                        LLM fact extraction
                            |
                     MongoDB Facts -> Pinecone (facts)
```

Fact extraction, normalization, reconciliation, and UI are intentionally outside this part.

## Structure

```text
factlayer/
├── index.js, worker.js, package.json
├── configs/       # MongoDB, Redis, and S3 clients
├── controllers/  # Thin HTTP controllers
├── middlewares/  # Upload and error handling
├── models/       # Document, Page, and Chunk schemas
├── queues/       # BullMQ queue
├── routes/       # Document endpoints
├── services/     # S3, PDF, chunk, embedding, and ingestion logic
├── utils/        # Response, error, async handler, constants
├── workers/      # BullMQ worker
└── tests/        # Node test runner tests
```

## Requirements and setup

Use Node.js 20 or newer. Start MongoDB and Redis locally, or provide reachable connection URLs. Create an S3 bucket with private access and credentials or IAM permissions for `PutObject` and `GetObject`. Create a Pinecone index with the dimension in `EMBEDDING_DIMENSION` (1536 for `text-embedding-3-small`) and a namespace. An OpenAI API key is required to generate those embeddings.

```sh
cp .env.example .env
npm install
```

The `.env` file contains `PORT`, `MONGO_URI`, `REDIS_URL`, AWS settings, Pinecone settings, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSION`, and `OPENAI_API_KEY`. It is ignored by git.

## Run

```sh
npm run start-server
npm run start-worker
npm run dev
npm test
```

The API listens on `http://localhost:3000` by default. The API and worker are separate processes; `npm run dev` starts both.

## API

Upload a PDF:

```sh
curl -X POST http://localhost:3000/api/documents/upload \
  -F "document=@./sample.pdf"
```

Inspect processing status:

```sh
curl http://localhost:3000/api/documents/<document-id>
```

Health check:

```sh
curl http://localhost:3000/health
```

Get all facts for a document:

```sh
curl http://localhost:3000/api/facts/document/<document-id>
```

Get one fact with its source document, page, chunk, and evidence:

```sh
curl http://localhost:3000/api/facts/<fact-id>
```

## Processing flow

The API creates the MongoDB document first so Mongoose supplies its ObjectId. That ObjectId becomes `documents/{documentId}/original.pdf` in S3. The upload response returns immediately after the BullMQ job is queued. The worker downloads the private PDF, persists source-numbered pages, creates deterministic character-bounded chunks, generates chunk embeddings in the `chunks` namespace, extracts validated facts with grounded source spans, stores facts in MongoDB, and writes fact embeddings to the separate `facts` namespace. Retries remove the prior pages, chunks, facts, and corresponding vector IDs before rebuilding them.

MongoDB is the source of truth for document metadata, pages, chunks, relationships, and processing errors. S3 is the source of truth for the original PDF. Pinecone only supports semantic retrieval; its metadata points back to authoritative MongoDB evidence.

## Limitations and next part

Scanned PDFs requiring OCR are not supported. Pinecone, the embedding provider, and the fact extraction model must be configured before processing can complete. Cross-document normalization, entity resolution, semantic matching, contradiction detection, and reconciliation remain future parts.