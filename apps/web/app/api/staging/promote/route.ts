import { NextRequest, NextResponse } from "next/server";
import { promoteToBank } from "../../../../modules/intake/staging-review";

interface PromoteRequestBody {
  id?: string;
  userId?: string;
}

// POST /api/staging/promote
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as PromoteRequestBody;
    const { id, userId } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Missing required parameter: id" },
        { status: 400 }
      );
    }

    const defaultUserId = "00000000-0000-0000-0000-000000000000";
    const promotedId = await promoteToBank(id, userId || defaultUserId);

    return NextResponse.json({ success: true, id: promotedId }, { status: 200 });
  } catch (err: unknown) {
    const isZod =
      typeof err === "object" &&
      err !== null &&
      (("name" in err && (err as { name: string }).name === "ZodError") || "issues" in err);
    const message = err instanceof Error ? err.message : "Failed to promote question to bank";
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
