import "dotenv/config";
import express from "express";
import cors from "cors";
import connectDatabase from "./configs/database.js";
import { connectRedis } from "./configs/redis.js";
import documentRoutes from "./routes/document.routes.js";
import factRoutes from "./routes/fact.routes.js";
import relationshipRoutes from "./routes/relationship.routes.js";
import errorMiddleware from "./middlewares/error.middleware.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "UP", timestamp: new Date().toISOString(), uptime: process.uptime() });
});
app.use("/api/documents", documentRoutes);
app.use("/api/facts", factRoutes);
app.use("/api/relationships", relationshipRoutes);
app.use(errorMiddleware);

const PORT = process.env.PORT || 3000;

const startServer = async () => {
  await connectDatabase();
  await connectRedis();
  app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
};

startServer();