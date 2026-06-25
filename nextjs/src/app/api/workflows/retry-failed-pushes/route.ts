import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { retryFailedPushesWorkflow } from "@/workflows/retry-failed-pushes";
import { verifyCronAuth } from "@/lib/cron-auth";

export async function GET(request: Request) {
  const unauthorized = verifyCronAuth(request);
  if (unauthorized) {
    return unauthorized;
  }

  const run = await start(retryFailedPushesWorkflow);

  return NextResponse.json({ runId: run.runId });
}
