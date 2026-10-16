import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateQuestions, QuestionGenParams } from "./generate-questions";

// Mock @google/genai
const mockGenerateContent = vi.fn();
vi.mock("@google/genai", () => {
  return {
    GoogleGenAI: vi.fn().mockImplementation(() => ({
      models: {
        generateContent: mockGenerateContent,
      },
    })),
  };
});

describe("generateQuestions", () => {
  const dummySubjectId = "11111111-1111-1111-1111-111111111111";
  const dummyTopicId = "22222222-2222-2222-2222-222222222222";
  const dummyUserId = "33333333-3333-3333-3333-333333333333";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls mocked AI client and parses structured output into StagingDraft[] preserving LaTeX math", async () => {
    const aiOutputJson = JSON.stringify([
      {
        text: "What is the time complexity of Dijkstra with binary heap? Given $G=(V, E)$, evaluate: $$\\sum_{v \\in V} \\deg(v) = 2|E|$$",
        type: "mcq",
        typeData: {
          options: [
            { id: "opt-1", text: "$O((V + E) \\log V)$" },
            { id: "opt-2", text: "$O(V^2)$" },
          ],
          correctOptionId: "opt-1",
        },
        confidenceScore: 0.95,
      },
    ]);

    mockGenerateContent.mockResolvedValueOnce({
      text: aiOutputJson,
    });

    const mockInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockResolvedValue({
        data: [
          {
            id: "44444444-4444-4444-4444-444444444444",
            subject_id: dummySubjectId,
            topic_id: dummyTopicId,
            type: "mcq",
            difficulty: "medium",
            marks: 5,
            text: "What is the time complexity of Dijkstra with binary heap? Given $G=(V, E)$, evaluate: $$\\sum_{v \\in V} \\deg(v) = 2|E|$$",
            image_refs: [],
            type_data: {
              options: [
                { id: "opt-1", text: "$O((V + E) \\log V)$" },
                { id: "opt-2", text: "$O(V^2)$" },
              ],
              correctOptionId: "opt-1",
            },
            source: "ai_generated",
            confidence_score: 0.95,
            raw_ai_output: { text: "What is..." },
            created_by: dummyUserId,
          },
        ],
        error: null,
      }),
    });

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        insert: mockInsert,
      }),
    };

    const params: QuestionGenParams = {
      subjectId: dummySubjectId,
      topicId: dummyTopicId,
      difficulty: "medium",
      marks: 5,
      count: 1,
      type: "mcq",
      createdBy: dummyUserId,
    };

    const results = await generateQuestions(params, { supabase: mockSupabase });

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    expect(mockSupabase.from).toHaveBeenCalledWith("staging_questions");
    expect(mockInsert).toHaveBeenCalledTimes(1);

    // Verify insertion parameters
    const insertedRows = mockInsert.mock.calls[0][0];
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0].subject_id).toBe(dummySubjectId);
    expect(insertedRows[0].source).toBe("ai_generated");
    expect(insertedRows[0].text).toContain("$G=(V, E)$");
    expect(insertedRows[0].text).toContain("$$\\sum_{v \\in V} \\deg(v) = 2|E|$$");

    // Verify output drafts
    expect(results).toHaveLength(1);
    expect(results[0].subjectId).toBe(dummySubjectId);
    expect(results[0].text).toContain("$G=(V, E)$");
    expect(results[0].text).toContain("$$\\sum_{v \\in V} \\deg(v) = 2|E|$$");
    expect(results[0].typeData).toEqual({
      options: [
        { id: "opt-1", text: "$O((V + E) \\log V)$" },
        { id: "opt-2", text: "$O(V^2)$" },
      ],
      correctOptionId: "opt-1",
    });
  });

  it("throws an error if Supabase insertion fails", async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify([
        {
          text: "Calculate $\\int_0^1 x^2 dx$",
          type: "numerical",
          typeData: { expectedValue: 0.33, tolerance: 0.01 },
        },
      ]),
    });

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({
            data: null,
            error: { message: "Database connection failed" },
          }),
        }),
      }),
    };

    const params: QuestionGenParams = {
      subjectId: dummySubjectId,
      difficulty: "easy",
      marks: 2,
      count: 1,
      createdBy: dummyUserId,
    };

    await expect(generateQuestions(params, { supabase: mockSupabase })).rejects.toThrow(
      /Database connection failed/
    );
  });
});
