import { router } from "@/server/trpc/init";
import { youtubeRouter } from "./dashboard/youtube";
import { billingRouter } from "./dashboard/billing";
import { apiKeysRouter } from "./dashboard/apiKeys";
import { jobsRouter } from "./dashboard/jobs";
import { commentsRouter } from "./dashboard/comments";

// Dashboard API
export const dashboardRouter = router({
  youtube: youtubeRouter,
  billing: billingRouter,
  apiKeys: apiKeysRouter,
  jobs: jobsRouter,
  comments: commentsRouter,
});

