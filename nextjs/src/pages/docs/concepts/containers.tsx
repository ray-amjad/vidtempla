import DocsArticle from "@/components/docs/DocsArticle";

export default function ContainersPage() {
  return (
    <DocsArticle
      path="/docs/concepts/containers"
      title="Containers"
      description="Combine templates into an ordered description structure that can be assigned to videos."
    >
      <p>
        A container is an ordered collection of templates. Its template order
        and separator determine how VidTempla renders the final description. One
        container can be assigned to many videos.
      </p>
      <h2>Create a container</h2>
      <ol>
        <li>Open YouTube Manager and select Containers.</li>
        <li>Select Create Container and name it.</li>
        <li>Select the templates to include and set a separator.</li>
      </ol>
      <h2>Edit a container</h2>
      <p>
        You can add, remove, and reorder templates, and change the separator. If
        those changes alter rendered descriptions, VidTempla shows the number of
        affected videos before you confirm and queues their updates in the
        background.
      </p>
      <h2>Delete a container</h2>
      <p>
        Deleting a container unassigns its videos. It does not delete the
        templates themselves.
      </p>
    </DocsArticle>
  );
}
