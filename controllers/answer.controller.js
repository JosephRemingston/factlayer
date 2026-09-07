import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import { answerQuestion } from "../services/answer.service.js";

const parseTopK = (value) => {
  const topK = Number(value || 10);
  if (!Number.isInteger(topK) || topK < 1 || topK > 30) throw ApiError.badRequest("topK must be an integer between 1 and 30");
  return topK;
};

const ask = async (req, res) => {
  const question = String(req.body?.question ?? req.query.q ?? "").trim();
  if (!question) throw ApiError.badRequest("A question is required (body.question or ?q=)");
  const result = await answerQuestion(question, { topK: parseTopK(req.body?.topK ?? req.query.topK) });
  return ApiResponse.success(res, "Answer generated successfully", result);
};

export { ask };
