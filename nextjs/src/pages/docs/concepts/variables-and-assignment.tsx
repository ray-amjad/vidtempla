import DocsArticle from "@/components/docs/DocsArticle";

export default function VariablesAndAssignmentPage() {
  return (
    <DocsArticle
      path="/docs/concepts/variables-and-assignment"
      title="Variables and video assignment"
      description="Personalize a container for each video and preview the description before queuing an update."
    >
      <h2>Assign a video</h2>
      <p>
        In the Videos tab, choose a video and assign a container. This links the
        video to the container’s template structure and initializes the
        variables used by those templates.
      </p>
      <h2>Set variable values</h2>
      <p>
        Open the video’s variable editor to set values for each detected
        placeholder. The editor groups fields by template and includes a preview
        built from the current template order, separator, and values.
      </p>
      <p>
        Saving queues a YouTube description update. VidTempla does not let a
        normal save overwrite a description it has detected as edited directly
        in YouTube Studio. Resolve the drift first, or explicitly choose the
        overwrite path offered in the editor.
      </p>
      <h2>Filter your video list</h2>
      <p>
        Videos can be filtered by channel, container, title search, and whether
        they have detected drift. The list loads more results as you scroll when
        additional videos are available.
      </p>
    </DocsArticle>
  );
}
