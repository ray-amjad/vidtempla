import Link from "next/link";
import DocsArticle from "@/components/docs/DocsArticle";

export default function FirstDescriptionPage() {
  return (
    <DocsArticle
      path="/docs/get-started/first-description"
      title="Create your first managed description"
      description="Build a reusable description, assign it to a video, and personalize it with variables."
    >
      <ol>
        <li>
          Create a template such as a standard introduction, disclosure, or call
          to action.
        </li>
        <li>Create a container and add that template to it.</li>
        <li>In Videos, select a video and assign the container.</li>
        <li>
          Open the video’s variables editor, review the description preview, and
          save values for its placeholders.
        </li>
      </ol>
      <p>
        Saving variable values queues the description update. When the video has
        a description edited directly in YouTube Studio, VidTempla asks you to
        resolve that drift before overwriting it.
      </p>
      <p>
        Read{" "}
        <Link href="/docs/concepts/variables-and-assignment">
          Variables and assignments
        </Link>{" "}
        for the precise behavior of that final step.
      </p>
    </DocsArticle>
  );
}
