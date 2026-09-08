/**
 * Allows the browser to PUT a PDF straight to S3. Without this the direct upload fails preflight,
 * because S3 (not the API) is the origin being called. Run once per bucket:
 *   node scripts/configure-s3-cors.mjs
 * Extra origins come from ALLOWED_ORIGINS, comma separated.
 */
import "dotenv/config";
import { GetBucketCorsCommand, PutBucketCorsCommand } from "@aws-sdk/client-s3";
import s3Client from "../configs/s3.js";

const bucket = process.env.AWS_BUCKET_NAME;
if (!bucket) throw new Error("AWS_BUCKET_NAME is required");

const origins = [
  "http://localhost:8080",
  "http://localhost:3000",
  "https://*.vercel.app",
  ...String(process.env.ALLOWED_ORIGINS || "").split(",").map((origin) => origin.trim()).filter(Boolean),
];

const before = await s3Client.send(new GetBucketCorsCommand({ Bucket: bucket })).catch(() => null);
console.log("current CORS rules:", before ? JSON.stringify(before.CORSRules) : "none");

await s3Client.send(new PutBucketCorsCommand({
  Bucket: bucket,
  CORSConfiguration: {
    CORSRules: [{
      AllowedMethods: ["PUT", "GET", "HEAD"],
      AllowedOrigins: origins,
      AllowedHeaders: ["*"],
      ExposeHeaders: ["ETag"],
      MaxAgeSeconds: 3000,
    }],
  },
}));
const after = await s3Client.send(new GetBucketCorsCommand({ Bucket: bucket }));
console.log("applied CORS rules:", JSON.stringify(after.CORSRules, null, 1));
