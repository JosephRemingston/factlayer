import "dotenv/config";
import express from "express";
import cors from "cors";
import connectDatabase from "./configs/database.js";
import documentRoutes from "./routes/document.routes.js";
import factRoutes from "./routes/fact.routes.js";
import relationshipRoutes from "./routes/relationship.routes.js";
import evidenceRoutes from "./routes/evidence.routes.js";
import answerRoutes from "./routes/answer.routes.js";
import showcaseRoutes from "./routes/showcase.routes.js";
import errorMiddleware from "./middlewares/error.middleware.js";
import { resumeInterruptedDocuments } from "./services/document.service.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "UP", timestamp: new Date().toISOString(), uptime: process.uptime() });
});
app.use("/api/documents", documentRoutes);
app.use("/api/facts", factRoutes);
app.use("/api/relationships", relationshipRoutes);
app.use("/api", evidenceRoutes);
app.use("/api", answerRoutes);
app.use("/api", showcaseRoutes);
app.use(errorMiddleware);

const PORT = process.env.PORT || 3000;

const startServer = async () => {
  await connectDatabase();
  app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
  const resumed = await resumeInterruptedDocuments();
  if (resumed) console.log(`Resumed ${resumed} interrupted document(s)`);
};

startServer().catch((error) => {
  console.error("Server startup failed:", error.message);
  process.exit(1);
});
