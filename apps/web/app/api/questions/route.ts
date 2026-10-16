import { NextRequest, NextResponse } from "next/server";
import { promoteToBank } from "../../../modules/intake/staging-review";

interface QuestionRequestBody {
  stagingId?: string;
  action?: string;
  id?: string;
  userId?: string;
}

// POST /api/questions
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as QuestionRequestBody;
    const stagingId = body.stagingId || (body.action === "promote" ? body.id : null);
    const userId = body.userId || "00000000-0000-0000-0000-000000000000";

    if (stagingId) {
      const id = await promoteToBank(stagingId, userId);
      return NextResponse.json({ success: true, id }, { status: 201 });
    }

    return NextResponse.json(
      { error: "Direct question insertion without staging is prohibited. Provide stagingId to promote." },
      { status: 400 }
    );
  } catch (err: unknown) {
    const isZod =
      typeof err === "object" &&
      err !== null &&
      (("name" in err && (err as { name: string }).name === "ZodError") || "issues" in err);
    const message = err instanceof Error ? err.message : "Failed to process question";
    const details =
      isZod && "issues" in (err as { issues: unknown })
        ? (err as { issues: unknown }).issues
        : undefined;

    return NextResponse.json(
      {
        error: message,
        details,
      },
      { status: isZod ? 422 : 500 }
    );
  }
}
