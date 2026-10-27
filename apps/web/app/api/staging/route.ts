import { NextRequest, NextResponse } from "next/server";
import { generateQuestions } from "../../../modules/intake/generate-questions";
import {
  extractFromScreenshot,
  extractFromText,
} from "../../../modules/intake/extract-from-input";
import {
  listStagingQuestions,
  updateStagingQuestion,
  discardStagingQuestion,
  promoteToBank,
} from "../../../modules/intake/staging-review";
import { StagingDraft } from "../../../modules/intake/generate-questions";

interface AuthSubjectAccessModule {
  assertSubjectAccess?: (subjectId: string) => Promise<void> | void;
}

interface StagingRequestBody {
  action?: string;
  id?: string;
  userId?: string;
  subjectId?: string;
  topicId?: string;
  topicName?: string;
  rawText?: string;
  imageBase64?: string;
  mimeType?: string;
  difficulty?: "easy" | "medium" | "hard";
  marks?: number;
  count?: number;
  type?: "mcq" | "numerical" | "long_answer";
  prompt?: string;
  additionalPrompt?: string;
  createdBy?: string;
}

interface StagingPatchBody {
  id?: string;
  patch?: Partial<StagingDraft>;
  [key: string]: unknown;
}

interface StagingDeleteBody {
  id?: string;
}

function handleError(err: unknown, defaultMessage: string): NextResponse {
  const isZod =
    typeof err === "object" &&
    err !== null &&
    (("name" in err && (err as { name: string }).name === "ZodError") || "issues" in err);
  const message = err instanceof Error ? err.message : defaultMessage;
  const status =
    typeof err === "object" && err !== null && "status" in err && typeof (err as { status: unknown }).status === "number"
      ? (err as { status: number }).status
      : isZod
        ? 422
        : 500;
  const details =
    isZod && "issues" in (err as { issues: unknown }) ? (err as { issues: unknown }).issues : undefined;

  return NextResponse.json({ error: message, details }, { status });
}

/**
 * Helper to optionally invoke assertSubjectAccess if implemented in auth track.
 */
async function verifySubjectAccess(subjectId: string) {
  try {
    const authPath: string = "../../../modules/auth/subject-access";
    const authModule = (await import(/* @vite-ignore */ authPath).catch(() => null)) as AuthSubjectAccessModule | null;
    if (authModule && typeof authModule.assertSubjectAccess === "function") {
      await authModule.assertSubjectAccess(subjectId);
    }
  } catch (err: unknown) {
    if (typeof err === "object" && err !== null && ("status" in err || "statusCode" in err)) {
      throw err;
    }
    // If not implemented or other non-auth error, proceed
  }
}

// GET /api/staging?subjectId=...
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const subjectId = searchParams.get("subjectId");

    if (!subjectId) {
      return NextResponse.json(
        { error: "Missing required query parameter: subjectId" },
        { status: 400 }
      );
    }

    await verifySubjectAccess(subjectId);

    const questions = await listStagingQuestions(subjectId);
    return NextResponse.json({ questions });
  } catch (err: unknown) {
    return handleError(err, "Failed to list staging questions");
  }
}

// POST /api/staging
export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") || "";

    // Multipart form upload (e.g. screenshot file upload)
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = (formData.get("file") || formData.get("image")) as File | null;
      const subjectId = formData.get("subjectId") as string | null;

      if (!file || !subjectId) {
        return NextResponse.json(
          { error: "Missing file or subjectId in form data" },
          { status: 400 }
        );
      }

      await verifySubjectAccess(subjectId);

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const mimeType = file.type || "image/png";

      const question = await extractFromScreenshot(buffer, mimeType, subjectId);
      return NextResponse.json({ question }, { status: 201 });
    }

    // JSON requests
    const body = (await request.json()) as StagingRequestBody;
    const action = body.action;

    if (body.subjectId) {
      await verifySubjectAccess(body.subjectId);
    }

    if (action === "promote") {
      if (!body.id) {
        return NextResponse.json({ error: "Missing draft id for promotion" }, { status: 400 });
      }
      const userId = body.userId || "00000000-0000-0000-0000-000000000000";
      const id = await promoteToBank(body.id, userId);
      return NextResponse.json({ success: true, id }, { status: 200 });
    }

    if (action === "extract_text" || body.rawText) {
      if (!body.rawText || !body.subjectId) {
        return NextResponse.json(
          { error: "rawText and subjectId are required for text extraction" },
          { status: 400 }
        );
      }
      const questions = await extractFromText(body.rawText, body.subjectId);
      return NextResponse.json({ questions }, { status: 201 });
    }

    if (action === "extract_screenshot" && body.imageBase64) {
      if (!body.subjectId) {
        return NextResponse.json({ error: "subjectId is required" }, { status: 400 });
      }
      const buffer = Buffer.from(body.imageBase64, "base64");
      const mimeType = body.mimeType || "image/png";
      const question = await extractFromScreenshot(buffer, mimeType, body.subjectId);
      return NextResponse.json({ question }, { status: 201 });
    }

    // Default to AI question generation
    if (!body.subjectId || !body.difficulty || typeof body.marks !== "number") {
      return NextResponse.json(
        { error: "subjectId, difficulty, and marks are required for generation" },
        { status: 400 }
      );
    }

    const questions = await generateQuestions({
      subjectId: body.subjectId,
      topicId: body.topicId,
      topicName: body.topicName,
      difficulty: body.difficulty,
      marks: body.marks,
      count: body.count || 1,
      type: body.type,
      prompt: body.prompt || body.additionalPrompt,
      createdBy: body.createdBy,
    });

    return NextResponse.json({ questions }, { status: 201 });
  } catch (err: unknown) {
    return handleError(err, "Failed to process staging request");
  }
}

// PATCH /api/staging
export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json()) as StagingPatchBody;
    const id = body.id;
    const patch = body.patch || body;

    if (!id) {
      return NextResponse.json({ error: "Missing required id" }, { status: 400 });
    }

    await updateStagingQuestion(id, patch);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return handleError(err, "Failed to update staging question");
  }
}

// DELETE /api/staging?id=...
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    let id = searchParams.get("id");

    if (!id) {
      const body = (await request.json().catch(() => ({}))) as StagingDeleteBody;
      id = body?.id || null;
    }

    if (!id) {
      return NextResponse.json({ error: "Missing required id" }, { status: 400 });
    }

    await discardStagingQuestion(id);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return handleError(err, "Failed to discard staging question");
  }
}
