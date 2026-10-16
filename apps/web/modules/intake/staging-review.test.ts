import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  listStagingQuestions,
  updateStagingQuestion,
  discardStagingQuestion,
  promoteToBank,
} from "./staging-review";

describe("staging-review lifecycle & promotion guard", () => {
  const dummySubjectId = "11111111-1111-1111-1111-111111111111";
  const dummyQuestionId = "22222222-2222-2222-2222-222222222222";
  const dummyUserId = "33333333-3333-3333-3333-333333333333";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listStagingQuestions", () => {
    it("returns formatted staging drafts for a subject", async () => {
      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: [
              {
                id: dummyQuestionId,
                subject_id: dummySubjectId,
                type: "mcq",
                difficulty: "easy",
                marks: 2,
                text: "Sample staged question",
                image_refs: [],
                type_data: { options: [], correctOptionId: "opt-1" },
                source: "ai_generated",
                created_by: dummyUserId,
              },
            ],
            error: null,
          }),
        }),
      });

      const mockSupabase = {
        from: vi.fn().mockReturnValue({ select: mockSelect }),
      };

      const drafts = await listStagingQuestions(dummySubjectId, { supabase: mockSupabase });
      expect(mockSupabase.from).toHaveBeenCalledWith("staging_questions");
      expect(drafts).toHaveLength(1);
      expect(drafts[0].id).toBe(dummyQuestionId);
      expect(drafts[0].subjectId).toBe(dummySubjectId);
    });
  });

  describe("updateStagingQuestion", () => {
    it("updates draft fields in staging_questions", async () => {
      const mockEq = vi.fn().mockResolvedValue({ error: null });
      const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });
      const mockSupabase = {
        from: vi.fn().mockReturnValue({ update: mockUpdate }),
      };

      await updateStagingQuestion(
        dummyQuestionId,
        { text: "Updated text", marks: 10 },
        { supabase: mockSupabase }
      );

      expect(mockSupabase.from).toHaveBeenCalledWith("staging_questions");
      expect(mockUpdate).toHaveBeenCalledWith({ text: "Updated text", marks: 10 });
      expect(mockEq).toHaveBeenCalledWith("id", dummyQuestionId);
    });
  });

  describe("discardStagingQuestion", () => {
    it("deletes the draft from staging_questions", async () => {
      const mockEq = vi.fn().mockResolvedValue({ error: null });
      const mockDelete = vi.fn().mockReturnValue({ eq: mockEq });
      const mockSupabase = {
        from: vi.fn().mockReturnValue({ delete: mockDelete }),
      };

      await discardStagingQuestion(dummyQuestionId, { supabase: mockSupabase });
      expect(mockSupabase.from).toHaveBeenCalledWith("staging_questions");
      expect(mockDelete).toHaveBeenCalledTimes(1);
      expect(mockEq).toHaveBeenCalledWith("id", dummyQuestionId);
    });
  });

  describe("promoteToBank", () => {
    it("successfully validates via parseQuestion, inserts into questions, and deletes from staging_questions", async () => {
      const stagingRow = {
        id: dummyQuestionId,
        subject_id: dummySubjectId,
        topic_id: null,
        type: "mcq",
        difficulty: "easy",
        marks: 5,
        text: "What is $2 + 2$?",
        image_refs: [],
        type_data: {
          options: [
            { id: "opt-1", text: "$4$" },
            { id: "opt-2", text: "$5$" },
          ],
          correctOptionId: "opt-1",
        },
        source: "ai_generated",
        created_by: dummyUserId,
      };

      const mockStagingSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: stagingRow, error: null }),
        }),
      });

      const mockQuestionsInsert = vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({
          data: [{ id: dummyQuestionId }],
          error: null,
        }),
      });

      const mockStagingDelete = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "staging_questions") {
            return {
              select: mockStagingSelect,
              delete: mockStagingDelete,
            };
          }
          if (table === "questions") {
            return {
              insert: mockQuestionsInsert,
            };
          }
          throw new Error(`Unexpected table ${table}`);
        }),
      };

      const promotedId = await promoteToBank(dummyQuestionId, dummyUserId, {
        supabase: mockSupabase,
      });

      expect(promotedId).toBe(dummyQuestionId);
      expect(mockQuestionsInsert).toHaveBeenCalledTimes(1);
      const insertedQuestion = mockQuestionsInsert.mock.calls[0][0][0];
      expect(insertedQuestion.id).toBe(dummyQuestionId);
      expect(insertedQuestion.subject_id).toBe(dummySubjectId);
      expect(insertedQuestion.created_by).toBe(dummyUserId);
      expect(mockStagingDelete).toHaveBeenCalledTimes(1);
    });

    it("throws ZodError and does NOT insert into questions if an MCQ draft has fewer than 2 options", async () => {
      const invalidRow = {
        id: dummyQuestionId,
        subject_id: dummySubjectId,
        topic_id: null,
        type: "mcq",
        difficulty: "easy",
        marks: 5,
        text: "Invalid MCQ with 1 option",
        image_refs: [],
        type_data: {
          options: [{ id: "opt-1", text: "Only one option" }],
          correctOptionId: "opt-1",
        },
        source: "ai_generated",
        created_by: dummyUserId,
      };

      const mockQuestionsInsert = vi.fn();
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "staging_questions") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: invalidRow, error: null }),
                }),
              }),
            };
          }
          if (table === "questions") {
            return { insert: mockQuestionsInsert };
          }
          throw new Error(`Unexpected table: ${table}`);
        }),
      };

      await expect(
        promoteToBank(dummyQuestionId, dummyUserId, { supabase: mockSupabase })
      ).rejects.toThrow(/MCQ needs at least two options/);

      expect(mockQuestionsInsert).not.toHaveBeenCalled();
    });

    it("throws ZodError and does NOT insert if correctOptionId does not match any option", async () => {
      const invalidRow = {
        id: dummyQuestionId,
        subject_id: dummySubjectId,
        topic_id: null,
        type: "mcq",
        difficulty: "easy",
        marks: 5,
        text: "MCQ with mismatched correctOptionId",
        image_refs: [],
        type_data: {
          options: [
            { id: "opt-1", text: "Alpha" },
            { id: "opt-2", text: "Beta" },
          ],
          correctOptionId: "opt-nonexistent",
        },
        source: "ai_generated",
        created_by: dummyUserId,
      };

      const mockQuestionsInsert = vi.fn();
      const mockSupabase = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === "staging_questions") {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: invalidRow, error: null }),
                }),
              }),
            };
          }
          if (table === "questions") {
            return { insert: mockQuestionsInsert };
          }
          throw new Error(`Unexpected table: ${table}`);
        }),
      };

      await expect(
        promoteToBank(dummyQuestionId, dummyUserId, { supabase: mockSupabase })
      ).rejects.toThrow(/correctOptionId must match/);

      expect(mockQuestionsInsert).not.toHaveBeenCalled();
    });
  });
});
