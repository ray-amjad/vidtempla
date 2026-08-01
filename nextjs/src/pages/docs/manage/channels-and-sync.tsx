import DocsArticle from "@/components/docs/DocsArticle";

export default function ChannelsAndSyncPage() {
  return (
    <DocsArticle
      path="/docs/manage/channels-and-sync"
      title="Channels and sync"
      description="Connect channels, sync their videos, and understand what happens when a channel is disconnected."
    >
      <p>
        The Channels tab lists the YouTube channels available to the active
        workspace. Connect a channel through the YouTube authorization flow,
        then use Sync to import its videos into VidTempla.
      </p>
      <h2>Syncing videos</h2>
      <p>
        A sync runs in the background and can take a few minutes. VidTempla
        shows a syncing state while it is in progress and refreshes the channel
        list until that state changes. You can then manage imported videos from
        the Videos tab.
      </p>
      <h2>Disconnecting a channel</h2>
      <p>
        Disconnecting removes the channel’s synced videos and their description
        history from VidTempla. Review the confirmation carefully before
        disconnecting a channel you still want to manage.
      </p>
    </DocsArticle>
  );
}
