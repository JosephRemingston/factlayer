import { PDFParse } from "pdf-parse";

const extractPdfPages = async (pdfBuffer) => {
  const parser = new PDFParse({ data: pdfBuffer });
  try {
    const result = await parser.getText();
    if (Array.isArray(result.pages) && result.pages.length > 0) {
      return result.pages.map((page, index) => ({
        pageNumber: page.num || index + 1,
        text: (page.text || "").trim(),
      }));
    }

    return [{ pageNumber: 1, text: (result.text || "").trim() }];
  } finally {
    await parser.destroy();
  }
};

export default extractPdfPages;