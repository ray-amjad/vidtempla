import { NextRequest, NextResponse } from "next/server";
import { withApiKey, requireWriteAccess, requireOrgAdmin, apiSuccess, apiError, logRequest } from "@/lib/api-auth";
import { getContainer, updateContainer, deleteContainer } from "@/lib/services/containers";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await withApiKey(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const result = await getContainer(id, auth.organizationId);

  if ("error" in result) {
    logRequest(auth, `/v1/containers/${id}`, "GET", result.error.status, 0);
    return NextResponse.json(apiError(result.error.code, result.error.message, result.error.suggestion, result.error.status), { status: result.error.status });
  }

  logRequest(auth, `/v1/containers/${id}`, "GET", 200, 0);
  return NextResponse.json(apiSuccess(result.data));
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await withApiKey(request);
  if (auth instanceof NextResponse) return auth;
  const writeCheck = requireWriteAccess(auth);
  if (writeCheck) return writeCheck;

  const { id } = await params;
  const body = await request.json();

  const result = await updateContainer(id, auth.userId, auth.organizationId, {
    name: body.name,
    templateIds: body.templateIds,
    separator: body.separator,
    force: body.force,
  });

  if ("error" in result) {
    logRequest(auth, `/v1/containers/${id}`, "PATCH", result.error.status, 0);
    return NextResponse.json(apiError(result.error.code, result.error.message, result.error.suggestion, result.error.status, result.error.meta), { status: result.error.status });
  }

  logRequest(auth, `/v1/containers/${id}`, "PATCH", 200, 0);
  return NextResponse.json(apiSuccess(result.data));
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await withApiKey(request);
  if (auth instanceof NextResponse) return auth;
  const writeCheck = requireWriteAccess(auth);
  if (writeCheck) return writeCheck;

  const { id } = await params;
  // Deleting a container unassigns its videos — admin or owner only, as in the
  // dashboard.
  const roleCheck = requireOrgAdmin(auth, `/v1/containers/${id}`, "DELETE");
  if (roleCheck) return roleCheck;

  const result = await deleteContainer(id, auth.organizationId);

  if ("error" in result) {
    logRequest(auth, `/v1/containers/${id}`, "DELETE", result.error.status, 0);
    return NextResponse.json(apiError(result.error.code, result.error.message, result.error.suggestion, result.error.status), { status: result.error.status });
  }

  logRequest(auth, `/v1/containers/${id}`, "DELETE", 200, 0);
  return NextResponse.json(apiSuccess(result.data));
}
