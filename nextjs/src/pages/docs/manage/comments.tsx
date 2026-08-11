import DocsArticle from "@/components/docs/DocsArticle";

export default function CommentsPage() {
  return (
    <DocsArticle
      path="/docs/manage/comments"
      title="Manage comments"
      description="Search a channel's comments, reply to them, and rewrite or remove them in batches of up to 40."
    >
      <p>
        The Comments tab searches a connected channel for comments as they are
        on YouTube right now. VidTempla does not store comments, so every search
        reads live results. The usual task is to find one comment that appears
        on many videos — for example a pinned link — and to rewrite it
        everywhere the link changed.
      </p>
      <h2>Search a channel</h2>
      <p>
        Select a channel, type the text to look for, then start the search. Each
        page of results costs 1 credit. Leave the search box empty to read the
        most recent comments on the channel.
      </p>
      <h2>Reply to a comment</h2>
      <p>
        Any workspace member can reply. A reply is new content, so it costs 50
        credits and it does not change an existing comment.
      </p>
      <h2>Rewrite comments in bulk</h2>
      <p>
        Admins and owners can rewrite the selected comments with one text. A
        batch holds at most 40 comments and applies to one channel. VidTempla
        records the previous text of every comment before it writes, then
        rewrites each comment in place. Editing in place keeps the comment, its
        likes, and its original date; deleting and posting again does not.
      </p>
      <p>
        Each rewritten comment costs 51 credits: 1 to read the previous text and
        50 to write the new text. If the daily YouTube quota runs out during a
        batch, the batch stops. The comments that were not attempted are
        reported as skipped, and you can send them again later.
      </p>
      <h2>Delete a comment</h2>
      <p>
        Admins and owners can delete a comment. Deletion is permanent and costs
        51 credits. YouTube keeps no history of the comment, so the record
        VidTempla writes before the deletion is the only remaining copy.
      </p>
      <h2>Comments on one video</h2>
      <p>
        Open the comments drawer from a row in the Videos tab to read the
        threads on that video and to reply to them.
      </p>
    </DocsArticle>
  );
}
