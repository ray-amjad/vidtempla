import { NextRequest, NextResponse } from "next/server";
import { withApiKey, requireWriteAccess, requireOrgAdmin, apiSuccess, apiError, logRequest } from "@/lib/api-auth";
import { revertDescription } from "@/lib/services/videos";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; historyId: string }> }
) {
  const auth = await withApiKey(request);
  if (auth instanceof NextResponse) return auth;
  const writeCheck = requireWriteAccess(auth);
  if (writeCheck) return writeCheck;

  const { id, historyId } = await params;
  // A revert delinks the video, clears its variables and pushes an old
  // description to YouTube — admin or owner only, as in the dashboard.
  const roleCheck = requireOrgAdmin(
    auth,
    `/v1/videos/${id}/history/${historyId}/revert`,
    "POST"
  );
  if (roleCheck) return roleCheck;

  const result = await revertDescription(id, historyId, auth.userId, auth.organizationId);

  if ("error" in result) {
    logRequest(auth, `/v1/videos/${id}/history/${historyId}/revert`, "POST", result.error.status, 0);
    return NextResponse.json(apiError(result.error.code, result.error.message, result.error.suggestion, result.error.status), { status: result.error.status });
  }

  logRequest(auth, `/v1/videos/${id}/history/${historyId}/revert`, "POST", 200, 0);
  return NextResponse.json(apiSuccess(result.data));
}
