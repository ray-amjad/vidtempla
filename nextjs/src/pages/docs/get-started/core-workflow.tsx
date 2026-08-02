import Link from "next/link";
import DocsArticle from "@/components/docs/DocsArticle";

export default function CoreWorkflowPage() {
  return (
    <DocsArticle
      path="/docs/get-started/core-workflow"
      title="Core workflow"
      description="Move from a connected YouTube channel to a repeatable, managed description workflow."
    >
      <ol>
        <li>
          <Link href="/docs/get-started/connect-youtube">
            Connect a YouTube channel
          </Link>{" "}
          and wait for its videos to sync.
        </li>
        <li>
          Create templates for reusable text such as an introduction,
          disclosure, or call to action.
        </li>
        <li>
          Put those templates into a container in the order they should render.
        </li>
        <li>Assign the container to a synced video.</li>
        <li>
          Set the video’s variable values and review its description preview.
        </li>
        <li>
          Follow the queued update from the Jobs page until it has finished.
        </li>
      </ol>
      <h2>Why the layers matter</h2>
      <p>
        Templates hold reusable content, containers decide its order and
        separator, and variables provide values for one video. That separation
        lets one template or container update affect the right assigned videos
        without recreating each description by hand.
      </p>
      <p>
        Continue with{" "}
        <Link href="/docs/manage/channels-and-sync">Channels and sync</Link> or
        read{" "}
        <Link href="/docs/concepts/description-lifecycle">
          the description lifecycle
        </Link>{" "}
        before making a bulk change.
      </p>
    </DocsArticle>
  );
}
