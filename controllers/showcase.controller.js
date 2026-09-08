import ApiResponse from "../utils/ApiResponse.js";
import { getShowcase } from "../services/showcase.service.js";

const showcase = async (req, res) => ApiResponse.success(res, "Showcase generated successfully", await getShowcase(req.owner));

export { showcase };
