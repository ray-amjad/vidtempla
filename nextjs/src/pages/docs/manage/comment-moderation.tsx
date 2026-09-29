import DocsArticle from "@/components/docs/DocsArticle";
import Link from "next/link";

export default function CommentModerationPage() {
  return (
    <DocsArticle
      path="/docs/manage/comment-moderation"
      title="Moderate comments automatically"
      description="Score new viewer comments with a rubric and hold, reject, ban, or delete the ones your rules match."
    >
      <p>
        The Moderation tab stores each new viewer comment on a channel, scores
        it against the channel&apos;s rubric, and applies your rules to it.
        Comments the channel writes itself are never scored or acted on.
        Comments posted before you turn moderation on are not imported.
      </p>
      <h2>Turn it on</h2>
      <p>
        Owners and admins select a channel and switch automatic moderation on.
        The first time, VidTempla publishes rubric v1 with the labels spam,
        self-promotion, scam, abusive, and normal, and with no rules, so new
        comments are scored but nothing is done to them until you add rules.
        Every 15 minutes VidTempla reads new comments and scores each one once,
        for 1 credit per comment. The tab shows the Jev model version that
        scored the latest comment and the status of the last run.
      </p>
      <h2>Rules</h2>
      <p>
        A rule reads &quot;if a label&apos;s probability is at least the
        threshold, take this action&quot;. The actions are flag, hold for
        review, reject, reject and ban the author, and delete. A probability
        equal to the threshold matches, so a 0.90 rule matches a score of 0.90.
        A threshold of 0 matches every comment, and the editor warns you. A
        threshold of 1 matches only a probability of exactly 1. When several
        rules match, the most severe action wins: delete, then ban, reject,
        hold, and flag. Flag is recorded in VidTempla only; every other action
        is a YouTube write and costs 50 credits.
      </p>
      <h2>Daily caps</h2>
      <p>
        Each channel allows at most 100 automatic rejects and bans and 10
        automatic deletes per day, counted from midnight Pacific. After a cap,
        matching comments are held instead, automation for that kind of action
        pauses, and a banner appears on the tab. It stays paused until an owner
        or admin presses Resume. Holds have no cap.
      </p>
      <h2>Review queue and maybe release</h2>
      <p>
        Held and flagged comments wait in the review queue. Owners and admins
        can select comments and hold, reject, ban, delete, or release them.
        Reject, ban, and delete cannot be undone, so the tab asks you to
        confirm and shows the credit cost first. VidTempla records the text of
        each comment before it rejects, bans, or deletes it. The action log
        lists every automatic and manual action, and shows when an action was
        applied as a weaker one, for example a delete held because of the cap.
      </p>
      <p>
        &quot;Maybe release&quot; lists held comments that no rule matches any
        more, usually after a new rubric version re-scored them. Nothing is
        released automatically; press Release to publish them again.
      </p>
      <h2>Improve the rubric</h2>
      <p>
        Any member can use &quot;Suggest correction&quot; on a comment to
        propose the right label. Owners and admins accept or reject each
        suggestion; an accepted one joins the next draft as an example. Edit
        the draft&apos;s labels and instructions, save it, then run a dry run.
        A dry run scores up to 40 recent stored comments with the saved draft
        and your rules and shows what would happen, without changing anything
        on YouTube. It costs 1 credit per comment scored, and the tab shows the
        count before you run it. Publish the draft to make it the live version:
        stored comments are re-scored with it at 1 credit each, and rules act
        only on comments that were never actioned before.
      </p>
      <h2>Who can do what</h2>
      <p>
        Every member can read scores, the review queue, and the action log,
        and can suggest corrections. Only owners and admins can turn moderation
        on or off, resume it, edit rules and the rubric, run a dry run, publish,
        review examples, and act on comments. Agents can read stored scores
        with the API; see <Link href="/docs/manage/comments">Manage comments</Link>.
      </p>
    </DocsArticle>
  );
}
