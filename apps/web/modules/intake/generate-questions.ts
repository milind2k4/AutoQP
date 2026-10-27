import { GoogleGenAI } from "@google/genai";
import { StagingQuestion } from "@autoqp/schema";
import { createClient } from "../../lib/supabase/server";
import { toCamelCaseRows, toSnakeCase } from "../../lib/supabase/transform";
import { SupabaseLike } from "./staging-review";

export type StagingDraft = StagingQuestion;

export interface QuestionGenParams {
  subjectId: string;
  topicId?: string | null;
  topicName?: string;
  difficulty: "easy" | "medium" | "hard";
  marks: number;
  count: number;
  type?: "mcq" | "numerical" | "long_answer";
  prompt?: string;
  additionalPrompt?: string;
  createdBy?: string;
}

export interface AiClientLike {
  models: {
    generateContent: (params: {
      model: string;
      contents: unknown;
    }) => Promise<{ text?: string | null }>;
  };
}

export interface GenerateOptions {
  supabase?: SupabaseLike;
  aiClient?: AiClientLike;
}

interface RawQuestionOutput {
  text?: string;
  type?: "mcq" | "numerical" | "long_answer";
  difficulty?: "easy" | "medium" | "hard";
  marks?: number;
  imageRefs?: string[];
  typeData?: Record<string, unknown>;
  confidenceScore?: number;
  [key: string]: unknown;
}

async function resolveSupabase(options?: GenerateOptions | SupabaseLike): Promise<SupabaseLike> {
  if (options && "from" in options && typeof options.from === "function") {
    return options as SupabaseLike;
  }
  if (options && "supabase" in options && options.supabase) {
    return options.supabase;
  }
  return (await createClient()) as unknown as SupabaseLike;
}

/**
 * Generates exam questions using Gemini AI, enforcing LaTeX math syntax ($...$ and $$...$$),
 * and stages them into the `staging_questions` table for human review.
 */
export async function generateQuestions(
  params: QuestionGenParams,
  options?: GenerateOptions | SupabaseLike
): Promise<StagingDraft[]> {
  const supabase = await resolveSupabase(options);

  const apiKey = process.env.GEMINI_API_KEY || "";
  const ai: AiClientLike =
    options && "aiClient" in options && options.aiClient
      ? options.aiClient
      : (new GoogleGenAI({
          apiKey: apiKey || "dummy-key-for-init",
        }) as unknown as AiClientLike);

  const questionTypeInstruction = params.type
    ? `All questions must be of type "${params.type}".`
    : `Questions can be a mix of "mcq", "numerical", or "long_answer".`;

  const promptText = `
You are an expert university exam question author.
Generate ${params.count} question(s) according to the following specifications:
- Difficulty: ${params.difficulty}
- Marks per question: ${params.marks}
${params.topicName ? `- Topic: ${params.topicName}` : ""}
${questionTypeInstruction}
${params.prompt || params.additionalPrompt ? `- Additional Guidelines: ${params.prompt || params.additionalPrompt}` : ""}

CRITICAL LATEX FORMATTING RULES:
1. All mathematical formulas, symbols, variables, and equations MUST strictly use standard LaTeX.
2. Format inline math using single dollar signs: $math$ (e.g., $G=(V, E)$, $O(V^2)$).
3. Format block / display math using double dollar signs: $$math$$ (e.g., $$\\sum_{i=1}^n i = \\frac{n(n+1)}{2}$$).
4. Never convert diagrams, charts, or figures into ASCII art.

OUTPUT FORMAT:
Return a valid JSON array containing exactly ${params.count} question objects. Do not include markdown code block formatting or explanation outside JSON.
Each object must follow this structure:
{
  "text": "Question stem text with LaTeX math like $x^2$ or $$E=mc^2$$",
  "type": "mcq" | "numerical" | "long_answer",
  "typeData": {
    // If type == "mcq":
    // "options": [{"id": "opt-1", "text": "Choice A"}, {"id": "opt-2", "text": "Choice B"}],
    // "correctOptionId": "opt-1"
    // If type == "numerical":
    // "expectedValue": 42.5, "tolerance": 0.1
    // If type == "long_answer":
    // "solution": "Detailed solution or marking rubric"
  },
  "confidenceScore": 0.95
}
`.trim();

  let rawResponseText = "";
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: promptText,
    });
    rawResponseText = response?.text ?? "";
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`AI generation failed: ${msg}`);
  }

  // Sanitize and parse JSON response
  let cleaned = rawResponseText.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-z]*\s*/i, "").replace(/```$/, "").trim();
  }

  let parsedQuestions: RawQuestionOutput[] = [];
  try {
    const parsed: unknown = JSON.parse(cleaned);
    parsedQuestions = Array.isArray(parsed) ? (parsed as RawQuestionOutput[]) : [parsed as RawQuestionOutput];
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse AI question output: ${msg}. Raw output: ${rawResponseText}`);
  }

  const defaultUserId = "00000000-0000-0000-0000-000000000000";
  const draftsToInsert = parsedQuestions.map((q) => {
    const draftId = crypto.randomUUID();
    const draft: StagingDraft = {
      id: draftId,
      subjectId: params.subjectId,
      topicId: params.topicId ?? null,
      type: q.type ?? params.type ?? "mcq",
      difficulty: params.difficulty,
      marks: params.marks,
      text: q.text ?? "",
      imageRefs: Array.isArray(q.imageRefs) ? q.imageRefs : [],
      typeData: q.typeData ?? {},
      source: "ai_generated",
      confidenceScore: typeof q.confidenceScore === "number" ? q.confidenceScore : 1.0,
      rawAiOutput: q as Record<string, unknown>,
      createdBy: params.createdBy ?? defaultUserId,
    };
    return draft;
  });

  const rowsToInsert = draftsToInsert.map((d) => toSnakeCase(d as unknown as Record<string, unknown>));

  const { data, error } = await supabase
    .from("staging_questions")
    .insert(rowsToInsert)
    .select();

  if (error) {
    throw new Error(`Failed to insert into staging_questions: ${error.message || JSON.stringify(error)}`);
  }

  return toCamelCaseRows<StagingDraft>(data as Record<string, unknown>[]);
}
