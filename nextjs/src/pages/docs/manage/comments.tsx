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
        on YouTube right now. Search never reads stored comments, so every search
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
        You can only rewrite comments the connected channel wrote. A channel
        search also finds comments from viewers; those cannot be selected for a
        rewrite, but you can still delete them.
      </p>
      <p>
        Each rewritten comment costs 51 credits: 1 to read the previous text and
        50 to write the new text. A batch stops early for three reasons: the
        daily YouTube quota ran out, YouTube applied a short-term limit, or the
        batch ran out of time. The comments that were not attempted are reported
        as skipped and cost nothing, and you can send them again later. The
        message on the last batch tells you which of the three happened and how
        long to wait.
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
      <h2>Read moderation scores from the API</h2>
      <p>
        When automatic comment moderation is enabled for a channel, VidTempla
        stores each new viewer comment and scores it against the channel's
        published rubric. Agents can read those scores with{" "}
        <code>GET /api/v1/youtube/comments/classifications?channelId=UC…</code>{" "}
        or the MCP tool <code>list_comment_classifications</code>. Each item
        holds the YouTube comment ID, the winning label, the probability of
        every label, the model version, and the moderation state the comment
        is in now. Filter by <code>label</code> and page with{" "}
        <code>cursor</code> and <code>limit</code> (at most 100).
      </p>
      <p>
        Both are free: they read stored scores only, with no YouTube call and
        no credits. They do not return comment text, and they cannot change
        rules, rubrics, or moderation actions; only owners and admins change
        those, in the dashboard. A channel that is not connected to the
        workspace returns 404.
      </p>
    </DocsArticle>
  );
}
