import DocsArticle from "@/components/docs/DocsArticle";

export default function ConnectYouTubePage() {
  return (
    <DocsArticle
      path="/docs/get-started/connect-youtube"
      title="Connect a YouTube channel"
      description="Authorize VidTempla to manage the channels in your workspace."
    >
      <ol>
        <li>Open YouTube Manager and select the Channels tab.</li>
        <li>
          Select <strong>Connect Your First Channel</strong> or Connect Channel.
        </li>
        <li>Complete the YouTube authorization flow in your browser.</li>
      </ol>
      <p>
        After authorization, VidTempla lists the connected channel with its
        subscriber count and last-sync time. Select Sync to import videos in the
        background. The channel list refreshes while a sync is running.
      </p>
      <h2>Reconnect when access expires</h2>
      <p>
        A channel that needs fresh authorization is marked
        <strong> Reconnect Required</strong>. Select Reconnect to run the
        authorization flow again. Do not disconnect a channel merely to renew
        access.
      </p>
      <h2>Channel limits</h2>
      <p>
        VidTempla checks your plan’s channel limit before starting a new
        connection. If you have reached the limit, upgrade your plan or
        disconnect a channel you no longer manage.
      </p>
    </DocsArticle>
  );
}
