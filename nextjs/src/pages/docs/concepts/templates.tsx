import DocsArticle from "@/components/docs/DocsArticle";

export default function TemplatesPage() {
  return (
    <DocsArticle
      path="/docs/concepts/templates"
      title="Templates"
      description="Create reusable description fragments and use placeholders for video-specific content."
    >
      <p>
        A template is a named block of description text. Use
        <code>{"{{variableName}}"}</code> placeholders where each video needs a
        different value. VidTempla detects the placeholders and shows them when
        you edit a video’s variables.
      </p>
      <h2>Create a template</h2>
      <ol>
        <li>Open YouTube Manager and select Templates.</li>
        <li>Select Create Template.</li>
        <li>Give it a name and enter its description content.</li>
      </ol>
      <h2>Update with care</h2>
      <p>
        When you change template content, VidTempla shows which containers and
        videos are affected before you confirm. Confirming queues background
        description updates for those videos. Changing only a template name does
        not alter rendered descriptions.
      </p>
      <h2>Delete a template</h2>
      <p>
        Delete only templates you no longer need. VidTempla asks for
        confirmation before deletion; review containers that use the template
        first so their description structure remains intentional.
      </p>
    </DocsArticle>
  );
}
