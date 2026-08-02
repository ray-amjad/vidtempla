import DocsArticle from "@/components/docs/DocsArticle";

export default function DescriptionLifecyclePage() {
  return (
    <DocsArticle
      path="/docs/concepts/description-lifecycle"
      title="Description lifecycle"
      description="Understand how VidTempla renders, updates, records, and protects managed YouTube descriptions."
    >
      <p>
        A managed description starts when a video is assigned to a container.
        VidTempla renders that container’s ordered templates with the video’s
        variable values, then queues an update to YouTube.
      </p>
      <h2>Changes that can queue an update</h2>
      <p>
        Saving a video’s variables queues an update for that video. Template and
        container changes can affect every assigned video, so VidTempla shows
        their affected-video count before you confirm the change.
      </p>
      <h2>Version history</h2>
      <p>
        VidTempla records description versions as it syncs, updates, and reverts
        a managed video. Open a video’s history to compare a saved version and
        restore it when needed.
      </p>
      <h2>Direct YouTube edits</h2>
      <p>
        If a description was edited directly in YouTube Studio after VidTempla
        last pushed it, the video is marked as drifted. VidTempla asks you to
        decide how to resolve that difference before a normal managed update
        replaces the YouTube edit.
      </p>
    </DocsArticle>
  );
}
