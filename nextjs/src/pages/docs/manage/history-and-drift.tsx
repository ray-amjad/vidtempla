import DocsArticle from "@/components/docs/DocsArticle";

export default function HistoryAndDriftPage() {
  return (
    <DocsArticle
      path="/docs/manage/history-and-drift"
      title="History, drift, and revert"
      description="Compare saved description versions, resolve direct YouTube edits, and restore an earlier managed description."
    >
      <h2>Detect drift</h2>
      <p>
        Drift means the description currently in YouTube differs from the last
        description VidTempla managed. Use the drift filter in Videos to find
        those videos, then open the video history drawer to review the change.
      </p>
      <h2>Resolve the difference</h2>
      <p>
        You can keep the YouTube edit or reapply the template-driven
        description. Reapplying overwrites the YouTube edit; keeping it avoids
        that overwrite and records the decision in the managed-description
        history.
      </p>
      <h2>Restore a version</h2>
      <p>
        Each history entry includes its rendered description and change source.
        Choose an earlier version to queue a revert. The resulting update is
        recorded in history, so the recovery itself is traceable.
      </p>
    </DocsArticle>
  );
}
