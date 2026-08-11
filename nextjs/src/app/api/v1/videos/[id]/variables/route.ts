import { NextRequest, NextResponse } from "next/server";
import { withApiKey, requireWriteAccess, apiSuccess, apiError, logRequest } from "@/lib/api-auth";
import { getVideoVariables, updateVideoVariables } from "@/lib/services/videos";
import {
  MAX_VARIABLES_PER_REQUEST,
  formatVariableIssues,
  videoVariableUpdatesSchema,
} from "@/lib/validation/videoVariables";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await withApiKey(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const result = await getVideoVariables(id, auth.userId, auth.organizationId);

  if ("error" in result) {
    logRequest(auth, `/v1/videos/${id}/variables`, "GET", result.error.status, 0);
    return NextResponse.json(apiError(result.error.code, result.error.message, result.error.suggestion, result.error.status), { status: result.error.status });
  }

  logRequest(auth, `/v1/videos/${id}/variables`, "GET", 200, 0);
  return NextResponse.json(apiSuccess(result.data));
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await withApiKey(request);
  if (auth instanceof NextResponse) return auth;
  const writeCheck = requireWriteAccess(auth);
  if (writeCheck) return writeCheck;

  const { id } = await params;

  let body: { variables?: unknown; force?: unknown };
  try {
    body = await request.json();
  } catch {
    logRequest(auth, `/v1/videos/${id}/variables`, "PUT", 400, 0);
    return NextResponse.json(
      apiError("INVALID_BODY", "Request body must be valid JSON", 'Send { "variables": [{ "templateId": "...", "name": "...", "value": "..." }] }', 400),
      { status: 400 }
    );
  }

  if (!Array.isArray(body?.variables)) {
    logRequest(auth, `/v1/videos/${id}/variables`, "PUT", 400, 0);
    return NextResponse.json(
      apiError("INVALID_BODY", "Request body must contain a 'variables' array", 'Send { "variables": [{ "templateId": "...", "name": "...", "value": "..." }] }', 400),
      { status: 400 }
    );
  }

  const parsedVariables = videoVariableUpdatesSchema.safeParse(body.variables);
  if (!parsedVariables.success) {
    logRequest(auth, `/v1/videos/${id}/variables`, "PUT", 400, 0);
    return NextResponse.json(
      apiError(
        "INVALID_BODY",
        `Invalid variables: ${formatVariableIssues(parsedVariables.error)}`,
        `Each entry needs a UUID 'templateId', a non-empty 'name' and a string 'value'. Send at most ${MAX_VARIABLES_PER_REQUEST} entries.`,
        400
      ),
      { status: 400 }
    );
  }

  const force = typeof body.force === "boolean" ? body.force : undefined;

  const result = await updateVideoVariables(id, parsedVariables.data, auth.userId, auth.organizationId, { force });

  if ("error" in result) {
    logRequest(auth, `/v1/videos/${id}/variables`, "PUT", result.error.status, 0);
    return NextResponse.json(apiError(result.error.code, result.error.message, result.error.suggestion, result.error.status, result.error.meta), { status: result.error.status });
  }

  logRequest(auth, `/v1/videos/${id}/variables`, "PUT", 200, 0);
  return NextResponse.json(apiSuccess(result.data));
}
