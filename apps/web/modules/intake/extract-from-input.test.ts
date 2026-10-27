import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractFromText, extractFromScreenshot } from "./extract-from-input";
import { SupabaseLike } from "./staging-review";

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

describe("extract-from-input", () => {
  const dummySubjectId = "11111111-1111-1111-1111-111111111111";
  const dummyUserId = "22222222-2222-2222-2222-222222222222";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("extractFromText", () => {
    it("parses unstructured text into question stems, options, and LaTeX math segments, then inserts into staging_questions", async () => {
      const rawText = "1. Solve for $x$: $2x + 5 = 15$. Options: A) $x = 5$, B) $x = 10$. Marks: 2";

      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify([
          {
            text: "Solve for $x$: $2x + 5 = 15$",
            type: "mcq",
            typeData: {
              options: [
                { id: "A", text: "$x = 5$" },
                { id: "B", text: "$x = 10$" },
              ],
              correctOptionId: "A",
            },
            marks: 2,
            difficulty: "easy",
            confidenceScore: 0.98,
          },
        ]),
      });

      const mockInsert = vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({
          data: [
            {
              id: "33333333-3333-3333-3333-333333333333",
              subject_id: dummySubjectId,
              type: "mcq",
              difficulty: "easy",
              marks: 2,
              text: "Solve for $x$: $2x + 5 = 15$",
              image_refs: [],
              type_data: {
                options: [
                  { id: "A", text: "$x = 5$" },
                  { id: "B", text: "$x = 10$" },
                ],
                correctOptionId: "A",
              },
              source: "ocr_extracted",
              confidence_score: 0.98,
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

      const drafts = await extractFromText(rawText, dummySubjectId, {
        supabase: mockSupabase,
        createdBy: dummyUserId,
      });

      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      expect(mockSupabase.from).toHaveBeenCalledWith("staging_questions");
      expect(drafts).toHaveLength(1);
      expect(drafts[0].subjectId).toBe(dummySubjectId);
      expect(drafts[0].text).toContain("$2x + 5 = 15$");
      expect(drafts[0].source).toBe("ocr_extracted");
      expect(drafts[0].typeData).toEqual({
        options: [
          { id: "A", text: "$x = 5$" },
          { id: "B", text: "$x = 10$" },
        ],
        correctOptionId: "A",
      });
    });

    it("throws an error if Supabase insertion fails", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify([
          {
            text: "Explain Newton's second law: $F = ma$",
            type: "long_answer",
            typeData: { solution: "$F = ma$" },
            marks: 5,
            difficulty: "medium",
          },
        ]),
      });

      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockResolvedValue({
              data: null,
              error: { message: "DB Error inserting staging question" },
            }),
          }),
        }),
      };

      await expect(
        extractFromText("Explain Newton's second law", dummySubjectId, {
          supabase: mockSupabase,
        })
      ).rejects.toThrow(/DB Error inserting staging question/);
    });
  });

  describe("extractFromScreenshot", () => {
    it("uploads diagram/image to Supabase Storage question-assets bucket, extracts LaTeX math, saves imageRef, and inserts into staging_questions", async () => {
      const dummyBuffer = Buffer.from("fake-png-binary-data");
      const mimeType = "image/png";

      const mockUpload = vi.fn().mockResolvedValue({
        data: { path: "question-assets/sample.png" },
        error: null,
      });

      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          text: "Refer to the circuit diagram below. Find the equivalent resistance across terminals $A$ and $B$: $R_{eq}$",
          type: "numerical",
          typeData: {
            expectedValue: 12.5,
            tolerance: 0.5,
          },
          difficulty: "hard",
          marks: 8,
          confidenceScore: 0.92,
        }),
      });

      const mockInsert = vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({
          data: [
            {
              id: "55555555-5555-5555-5555-555555555555",
              subject_id: dummySubjectId,
              type: "numerical",
              difficulty: "hard",
              marks: 8,
              text: "Refer to the circuit diagram below. Find the equivalent resistance across terminals $A$ and $B$: $R_{eq}$",
              image_refs: ["question-assets/sample.png"],
              type_data: {
                expectedValue: 12.5,
                tolerance: 0.5,
              },
              source: "ocr_extracted",
              confidence_score: 0.92,
              created_by: dummyUserId,
            },
          ],
          error: null,
        }),
      });

      const mockSupabase = {
        storage: {
          from: vi.fn().mockReturnValue({
            upload: mockUpload,
          }),
        },
        from: vi.fn().mockReturnValue({
          insert: mockInsert,
        }),
      };

      const result = await extractFromScreenshot(dummyBuffer, mimeType, dummySubjectId, {
        supabase: mockSupabase,
        createdBy: dummyUserId,
      });

      // Storage verification
      expect(mockSupabase.storage.from).toHaveBeenCalledWith("question-assets");
      expect(mockUpload).toHaveBeenCalledTimes(1);
      const uploadArgs = mockUpload.mock.calls[0];
      expect(uploadArgs[1]).toBe(dummyBuffer);
      expect(uploadArgs[2]).toEqual({ contentType: mimeType, upsert: true });

      // AI call verification
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);

      // Staging table insert verification
      expect(mockSupabase.from).toHaveBeenCalledWith("staging_questions");
      const insertedRow = mockInsert.mock.calls[0][0][0];
      expect(insertedRow.subject_id).toBe(dummySubjectId);
      expect(insertedRow.image_refs).toHaveLength(1);
      expect(insertedRow.source).toBe("ocr_extracted");
      expect(insertedRow.text).toContain("$R_{eq}$");

      // Output draft verification
      expect(result.id).toBe("55555555-5555-5555-5555-555555555555");
      expect(result.imageRefs).toEqual(["question-assets/sample.png"]);
      expect(result.type).toBe("numerical");
    });

    it("throws an error if storage upload fails", async () => {
      const dummyBuffer = Buffer.from("fake-png");
      const mockSupabase = {
        from: vi.fn(),
        storage: {
          from: vi.fn().mockReturnValue({
            upload: vi.fn().mockResolvedValue({
              data: null,
              error: { message: "Storage bucket access denied" },
            }),
          }),
        },
      };

      await expect(
        extractFromScreenshot(dummyBuffer, "image/png", dummySubjectId, {
          supabase: mockSupabase as unknown as SupabaseLike,
        })
      ).rejects.toThrow(/Storage upload failed: Storage bucket access denied/);
    });
  });
});
