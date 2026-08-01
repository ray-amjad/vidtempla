import DocsArticle from "@/components/docs/DocsArticle";

export default function VideosPage() {
  return (
    <DocsArticle
      path="/docs/manage/videos"
      title="Manage videos"
      description="Find synced videos, assign a description container, edit variables, and review managed-description status."
    >
      <p>
        The Videos tab is the working list for videos imported from connected
        channels. Filter it by channel, assigned container, title, or drift
        status to find the video you need.
      </p>
      <h2>Assign a container</h2>
      <p>
        Assigning a container gives a video the template structure used to
        render its description. Then open the variables editor to set the values
        that are unique to that video and review the resulting preview.
      </p>
      <h2>Inspect a managed video</h2>
      <p>
        A video can show whether a container is assigned and whether VidTempla
        has detected a direct YouTube edit. Open its history for prior
        description versions and the available recovery actions.
      </p>
    </DocsArticle>
  );
}
