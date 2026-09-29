import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { commentSweepWorkflow } from "@/workflows/comment-sweep";
import { verifyCronAuth } from "@/lib/cron-auth";

export async function GET(request: Request) {
  const unauthorized = verifyCronAuth(request);
  if (unauthorized) {
    return unauthorized;
  }

  const run = await start(commentSweepWorkflow);

  return NextResponse.json({ runId: run.runId });
}
