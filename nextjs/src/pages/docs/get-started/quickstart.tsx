import Link from "next/link";
import DocsArticle from "@/components/docs/DocsArticle";

export default function QuickstartPage() {
  return (
    <DocsArticle
      path="/docs/get-started/quickstart"
      title="Quickstart"
      description="Set up a repeatable YouTube description workflow with VidTempla."
    >
      <p>
        VidTempla manages descriptions in four connected layers: a YouTube
        channel, reusable templates, a container that orders those templates,
        and variable values for each video.
      </p>
      <ol>
        <li>
          <Link href="/docs/get-started/connect-youtube">
            Connect a YouTube channel
          </Link>{" "}
          from the Channels tab.
        </li>
        <li>Create templates for the reusable parts of a description.</li>
        <li>
          Put templates in a container in the order you want them rendered.
        </li>
        <li>
          Assign a video to that container and fill in its variable values.
        </li>
      </ol>
      <h2>Where to work</h2>
      <p>
        Open <strong>YouTube Manager</strong> in the dashboard. Its tabs are
        Channels, Videos, Containers, and Templates. Start with Channels, then
        move through Templates and Containers before assigning videos.
      </p>
      <h2>What VidTempla updates</h2>
      <p>
        Changing a template’s content, a container’s order or separator, or a
        video’s variables can queue description updates for affected videos.
        VidTempla shows the affected-video count before template and container
        changes that alter rendered descriptions.
      </p>
      <p>
        Continue with <Link href="/docs/concepts/templates">Templates</Link> to
        create the reusable building blocks.
      </p>
    </DocsArticle>
  );
}
