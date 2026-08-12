import { NextRequest, NextResponse } from "next/server";
import { withApiKey, requireWriteAccess, requireOrgAdmin, apiSuccess, apiError, logRequest } from "@/lib/api-auth";
import { getTemplate, updateTemplate, deleteTemplate } from "@/lib/services/templates";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await withApiKey(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const result = await getTemplate(id, auth.organizationId);

  if ("error" in result) {
    logRequest(auth, `/v1/templates/${id}`, "GET", result.error.status, 0);
    return NextResponse.json(apiError(result.error.code, result.error.message, result.error.suggestion, result.error.status), { status: result.error.status });
  }

  logRequest(auth, `/v1/templates/${id}`, "GET", 200, 0);
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

  const result = await updateTemplate(id, auth.userId, auth.organizationId, {
    name: body.name,
    content: body.content,
    force: body.force,
  });

  if ("error" in result) {
    logRequest(auth, `/v1/templates/${id}`, "PATCH", result.error.status, 0);
    return NextResponse.json(apiError(result.error.code, result.error.message, result.error.suggestion, result.error.status, result.error.meta), { status: result.error.status });
  }

  logRequest(auth, `/v1/templates/${id}`, "PATCH", 200, 0);
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
  const roleCheck = requireOrgAdmin(auth, `/v1/templates/${id}`, "DELETE");
  if (roleCheck) return roleCheck;

  const result = await deleteTemplate(id, auth.organizationId);

  if ("error" in result) {
    logRequest(auth, `/v1/templates/${id}`, "DELETE", result.error.status, 0);
    return NextResponse.json(apiError(result.error.code, result.error.message, result.error.suggestion, result.error.status), { status: result.error.status });
  }

  logRequest(auth, `/v1/templates/${id}`, "DELETE", 200, 0);
  return NextResponse.json(apiSuccess(result.data));
}
