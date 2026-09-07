import "dotenv/config";
import connectDatabase from "./configs/database.js";
import { connectRedis } from "./configs/redis.js";

await connectDatabase();
await connectRedis();
await import("./workers/document.workers.js");
console.log("Document worker is running");