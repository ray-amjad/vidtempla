import DocsArticle from "@/components/docs/DocsArticle";

export default function JobsPage() {
  return (
    <DocsArticle
      path="/docs/manage/jobs"
      title="Description update jobs"
      description="Track the background updates created by template, container, variable, and drift changes."
    >
      <p>
        VidTempla groups each description push into a job. Jobs are created for
        template and container edits, variable updates, manual updates, drift
        resolution, and retries.
      </p>
      <h2>Read job progress</h2>
      <p>
        The Jobs page shows the newest jobs first and refreshes while any job is
        running. Open a job to see each video’s outcome. A job can be queued,
        updating, retrying, completed, completed with errors, or superseded.
      </p>
      <h2>Investigate failures</h2>
      <p>
        A failed item exposes its most recent error in the job detail view.
        Retry activity remains associated with the original job when possible,
        so the final status reflects the video’s actual outcome.
      </p>
    </DocsArticle>
  );
}
