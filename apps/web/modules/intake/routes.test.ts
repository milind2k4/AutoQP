import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST, PATCH, DELETE } from "../../app/api/staging/route";
import { POST as POST_PROMOTE } from "../../app/api/staging/promote/route";
import { POST as POST_QUESTIONS } from "../../app/api/questions/route";

vi.mock("./generate-questions", () => ({
  generateQuestions: vi.fn().mockResolvedValue([
    { id: "gen-1", text: "Generated question", subjectId: "sub-1" },
  ]),
}));

vi.mock("./extract-from-input", () => ({
  extractFromText: vi.fn().mockResolvedValue([
    { id: "ext-1", text: "Extracted question", subjectId: "sub-1" },
  ]),
  extractFromScreenshot: vi.fn().mockResolvedValue({
    id: "screen-1",
    text: "Extracted from image",
    subjectId: "sub-1",
  }),
}));

vi.mock("./staging-review", () => ({
  listStagingQuestions: vi.fn().mockResolvedValue([
    { id: "list-1", text: "Staged question", subjectId: "sub-1" },
  ]),
  updateStagingQuestion: vi.fn().mockResolvedValue(undefined),
  discardStagingQuestion: vi.fn().mockResolvedValue(undefined),
  promoteToBank: vi.fn().mockImplementation((id: string) => Promise.resolve(id)),
}));

describe("API Route Handlers", () => {
  const dummySubjectId = "11111111-1111-1111-1111-111111111111";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/staging", () => {
    it("returns 400 when subjectId is missing", async () => {
      const req = new NextRequest("http://localhost/api/staging");
      const res = await GET(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("Missing required query parameter");
    });

    it("returns questions for valid subjectId", async () => {
      const req = new NextRequest(`http://localhost/api/staging?subjectId=${dummySubjectId}`);
      const res = await GET(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.questions).toHaveLength(1);
      expect(json.questions[0].id).toBe("list-1");
    });
  });

  describe("POST /api/staging", () => {
    it("handles AI generation", async () => {
      const req = new NextRequest("http://localhost/api/staging", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate",
          subjectId: dummySubjectId,
          difficulty: "medium",
          marks: 5,
          count: 1,
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.questions).toHaveLength(1);
      expect(json.questions[0].id).toBe("gen-1");
    });

    it("handles raw text extraction", async () => {
      const req = new NextRequest("http://localhost/api/staging", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "extract_text",
          subjectId: dummySubjectId,
          rawText: "Sample test item",
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.questions).toHaveLength(1);
      expect(json.questions[0].id).toBe("ext-1");
    });

    it("handles promotion action", async () => {
      const req = new NextRequest("http://localhost/api/staging", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "promote",
          id: "draft-123",
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.id).toBe("draft-123");
    });
  });

  describe("PATCH /api/staging", () => {
    it("updates staging question", async () => {
      const req = new NextRequest("http://localhost/api/staging", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "draft-123",
          patch: { text: "Updated" },
        }),
      });

      const res = await PATCH(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });
  });

  describe("DELETE /api/staging", () => {
    it("deletes staging question", async () => {
      const req = new NextRequest("http://localhost/api/staging?id=draft-123", {
        method: "DELETE",
      });

      const res = await DELETE(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });
  });

  describe("POST /api/staging/promote", () => {
    it("promotes draft to bank", async () => {
      const req = new NextRequest("http://localhost/api/staging/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "draft-777" }),
      });

      const res = await POST_PROMOTE(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.id).toBe("draft-777");
    });
  });

  describe("POST /api/questions", () => {
    it("rejects direct insertion without stagingId", async () => {
      const req = new NextRequest("http://localhost/api/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Direct bypass attempt" }),
      });

      const res = await POST_QUESTIONS(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("Direct question insertion without staging is prohibited");
    });

    it("promotes draft when stagingId is provided", async () => {
      const req = new NextRequest("http://localhost/api/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stagingId: "draft-888" }),
      });

      const res = await POST_QUESTIONS(req);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.id).toBe("draft-888");
    });
  });
});
