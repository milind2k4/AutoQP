import { GoogleGenAI } from "@google/genai";
import { createClient } from "../../lib/supabase/server";
import { toCamelCase, toCamelCaseRows, toSnakeCase } from "../../lib/supabase/transform";
import { StagingDraft, AiClientLike } from "./generate-questions";
import { SupabaseLike } from "./staging-review";

export interface ExtractOptions {
  supabase?: SupabaseLike;
  aiClient?: AiClientLike;
  createdBy?: string;
  bucketName?: string;
}

interface RawExtractedItem {
  text?: string;
  type?: "mcq" | "numerical" | "long_answer";
  difficulty?: "easy" | "medium" | "hard";
  marks?: number;
  imageRefs?: string[];
  typeData?: Record<string, unknown>;
  confidenceScore?: number;
  [key: string]: unknown;
}

async function resolveSupabase(options?: ExtractOptions | SupabaseLike): Promise<SupabaseLike> {
  if (options && "from" in options && typeof options.from === "function") {
    return options as SupabaseLike;
  }
  if (options && "supabase" in options && options.supabase) {
    return options.supabase;
  }
  return (await createClient()) as unknown as SupabaseLike;
}

/**
 * Parses unstructured pasted text into question drafts with LaTeX math preservation
 * and inserts them into `staging_questions`.
 */
export async function extractFromText(
  rawText: string,
  subjectId: string,
  options?: ExtractOptions | SupabaseLike
): Promise<StagingDraft[]> {
  const supabase = await resolveSupabase(options);

  const apiKey = process.env.GEMINI_API_KEY || "";
  const ai: AiClientLike =
    options && "aiClient" in options && options.aiClient
      ? options.aiClient
      : (new GoogleGenAI({
          apiKey: apiKey || "dummy-key-for-init",
        }) as unknown as AiClientLike);

  const prompt = `
You are an expert exam question extractor.
Analyze the following unstructured text and extract one or more exam questions.

RAW INPUT:
"""
${rawText}
"""

CRITICAL LATEX AND MATH RULES:
1. Every mathematical symbol, equation, variable, or formula must strictly use standard LaTeX.
2. Use single dollar signs ($math$) for inline math (e.g. $x^2 + y^2 = r^2$, $O(n \\log n)$).
3. Use double dollar signs ($$math$$) for block or display math.
4. Do NOT approximate math with plain text or Unicode symbols.
5. Do NOT convert diagrams or figures into ASCII art.

OUTPUT FORMAT:
Return a valid JSON array of question objects without markdown wrapping:
[
  {
    "text": "The question stem with LaTeX math",
    "type": "mcq" | "numerical" | "long_answer",
    "typeData": {
      // For MCQ: "options": [{"id": "A", "text": "Choice A"}, ...], "correctOptionId": "A"
      // For Numerical: "expectedValue": 42.0, "tolerance": 0.05
      // For Long Answer: "solution": "Detailed explanation"
    },
    "difficulty": "easy" | "medium" | "hard",
    "marks": 5,
    "confidenceScore": 0.95
  }
]
`.trim();

  let rawResponse = "";
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });
    rawResponse = response?.text ?? "";
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`AI extraction failed: ${msg}`);
  }

  let cleaned = rawResponse.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-z]*\s*/i, "").replace(/```$/, "").trim();
  }

  let parsed: RawExtractedItem[] = [];
  try {
    const json: unknown = JSON.parse(cleaned);
    parsed = Array.isArray(json) ? (json as RawExtractedItem[]) : [json as RawExtractedItem];
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse extracted JSON: ${msg}. Raw output: ${rawResponse}`);
  }

  const defaultUserId = "00000000-0000-0000-0000-000000000000";
  const draftsToInsert = parsed.map((item) => {
    const draftId = crypto.randomUUID();
    const draft: StagingDraft = {
      id: draftId,
      subjectId,
      topicId: null,
      type: item.type ?? "mcq",
      difficulty: item.difficulty ?? "medium",
      marks: typeof item.marks === "number" ? item.marks : 5,
      text: item.text ?? "",
      imageRefs: [],
      typeData: item.typeData ?? {},
      source: "ocr_extracted",
      confidenceScore: typeof item.confidenceScore === "number" ? item.confidenceScore : 0.9,
      rawAiOutput: item as Record<string, unknown>,
      createdBy: options && "createdBy" in options && options.createdBy ? options.createdBy : defaultUserId,
    };
    return draft;
  });

  const dbRows = draftsToInsert.map((d) => toSnakeCase(d as unknown as Record<string, unknown>));
  const { data, error } = await supabase
    .from("staging_questions")
    .insert(dbRows)
    .select();

  if (error) {
    throw new Error(`Failed to insert into staging_questions: ${error.message || JSON.stringify(error)}`);
  }

  return toCamelCaseRows<StagingDraft>(data as Record<string, unknown>[]);
}

/**
 * Processes an exam question screenshot:
 * 1. Uploads the image binary to Supabase Storage in the `question-assets` bucket.
 * 2. Transcribes text/equations into LaTeX math using Gemini Vision without converting diagrams to ASCII.
 * 3. Populates `imageRefs` with the storage path and inserts the question into `staging_questions`.
 */
export async function extractFromScreenshot(
  imageBuffer: Buffer,
  mimeType: string,
  subjectId: string,
  options?: ExtractOptions | SupabaseLike
): Promise<StagingDraft> {
  const supabase = await resolveSupabase(options);

  const bucket =
    options && "bucketName" in options && options.bucketName ? options.bucketName : "question-assets";
  const extension = mimeType.split("/")[1]?.replace("+xml", "") || "png";
  const storageFilePath = `${subjectId}/${crypto.randomUUID()}.${extension}`;

  if (!supabase.storage) {
    throw new Error("Supabase storage client is not available");
  }

  // 1. Upload image to Supabase Storage
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(storageFilePath, imageBuffer, {
      contentType: mimeType,
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`Storage upload failed: ${uploadError.message || JSON.stringify(uploadError)}`);
  }

  const savedImagePath = uploadData?.path || storageFilePath;

  // 2. Call Gemini Vision
  const apiKey = process.env.GEMINI_API_KEY || "";
  const ai: AiClientLike =
    options && "aiClient" in options && options.aiClient
      ? options.aiClient
      : (new GoogleGenAI({
          apiKey: apiKey || "dummy-key-for-init",
        }) as unknown as AiClientLike);

  const prompt = `
You are an expert exam OCR and document transcription system.
Analyze the provided screenshot of an exam question.

BINDING RULES:
1. Transcribe all question text and mathematical equations into standard LaTeX.
2. Use $math$ for inline equations and $$math$$ for display equations.
3. CRITICAL: Never convert diagrams, circuit schematics, geometric figures, charts, or graphs into ASCII art. The diagram is already stored as an image asset.
4. Extract structured details: question stem, question type ("mcq" | "numerical" | "long_answer"), typeData, difficulty ("easy" | "medium" | "hard"), and marks.

OUTPUT FORMAT:
Return only valid JSON matching this structure without markdown fences:
{
  "text": "Transcribed question text with LaTeX math like $E = mc^2$",
  "type": "mcq" | "numerical" | "long_answer",
  "typeData": {
    // If mcq: "options": [{"id": "A", "text": "Choice A"}, ...], "correctOptionId": "A"
    // If numerical: "expectedValue": 10.5, "tolerance": 0.1
    // If long_answer: "solution": "Marking guide"
  },
  "difficulty": "easy" | "medium" | "hard",
  "marks": 5,
  "confidenceScore": 0.95
}
`.trim();

  let rawResponse = "";
  try {
    const base64Data = imageBuffer.toString("base64");
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          text: prompt,
        },
        {
          inlineData: {
            data: base64Data,
            mimeType,
          },
        },
      ],
    });
    rawResponse = response?.text ?? "";
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`AI vision extraction failed: ${msg}`);
  }

  let cleaned = rawResponse.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-z]*\s*/i, "").replace(/```$/, "").trim();
  }

  let parsed: RawExtractedItem = {};
  try {
    const json: unknown = JSON.parse(cleaned);
    parsed = Array.isArray(json) ? (json[0] as RawExtractedItem) : (json as RawExtractedItem);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse vision response JSON: ${msg}. Raw: ${rawResponse}`);
  }

  const defaultUserId = "00000000-0000-0000-0000-000000000000";
  const draftId = crypto.randomUUID();
  const draft: StagingDraft = {
    id: draftId,
    subjectId,
    topicId: null,
    type: parsed.type ?? "mcq",
    difficulty: parsed.difficulty ?? "medium",
    marks: typeof parsed.marks === "number" ? parsed.marks : 5,
    text: parsed.text ?? "",
    imageRefs: [savedImagePath],
    typeData: parsed.typeData ?? {},
    source: "ocr_extracted",
    confidenceScore: typeof parsed.confidenceScore === "number" ? parsed.confidenceScore : 0.9,
    rawAiOutput: parsed as Record<string, unknown>,
    createdBy: options && "createdBy" in options && options.createdBy ? options.createdBy : defaultUserId,
  };

  const dbRow = toSnakeCase(draft as unknown as Record<string, unknown>);
  const { data, error } = await supabase
    .from("staging_questions")
    .insert([dbRow])
    .select();

  if (error) {
    throw new Error(`Failed to insert into staging_questions: ${error.message || JSON.stringify(error)}`);
  }

  const rows = data as Record<string, unknown>[];
  const result = toCamelCase<StagingDraft>(rows?.[0]);
  if (!result) {
    throw new Error("Failed to retrieve inserted staging question row");
  }

  return result;
}
