import assert from "node:assert/strict";
import test from "node:test";

const { leanComment, leanThread, threadAuthoredByChannel } = await import(
  "../../src/lib/mcp/comment-projection.ts"
);

const CHANNEL = "UCownerchannel00000000";

/** A thread as YouTube actually sends it, noise fields included. */
function rawThread(overrides = {}) {
  return {
    kind: "youtube#commentThread",
    etag: "etag-thread",
    id: "thread-1",
    snippet: {
      channelId: CHANNEL,
      videoId: "dQw4w9WgXcQ",
      canReply: true,
      totalReplyCount: 1,
      isPublic: true,
      topLevelComment: {
        kind: "youtube#comment",
        etag: "etag-comment",
        id: "comment-1",
        snippet: {
          channelId: CHANNEL,
          videoId: "dQw4w9WgXcQ",
          textDisplay: "See example.test",
          textOriginal: "See example.test",
          authorDisplayName: "Owner Channel",
          authorProfileImageUrl: "https://yt3.ggpht.com/x",
          authorChannelUrl: "http://www.youtube.com/channel/x",
          authorChannelId: { value: CHANNEL },
          canRate: true,
          viewerRating: "none",
          likeCount: 3,
          publishedAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-08-12T00:00:00Z",
        },
      },
      ...overrides,
    },
  };
}

test("noise fields are dropped and authorChannelId flattens", () => {
  const lean = leanThread(rawThread());
  assert.deepEqual(Object.keys(lean), ["id", "snippet"]);
  assert.deepEqual(lean.snippet, {
    videoId: "dQw4w9WgXcQ",
    canReply: true,
    totalReplyCount: 1,
    isPublic: true,
    topLevelComment: {
      id: "comment-1",
      snippet: {
        textOriginal: "See example.test",
        authorDisplayName: "Owner Channel",
        authorChannelId: CHANNEL,
        likeCount: 3,
        publishedAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-08-12T00:00:00Z",
      },
    },
  });
});

test("a third-party comment keeps textDisplay, its only copy of the text", () => {
  const raw = rawThread();
  delete raw.snippet.topLevelComment.snippet.textOriginal;
  raw.snippet.topLevelComment.snippet.textDisplay = "great video";
  const { snippet } = leanThread(raw).snippet.topLevelComment;
  assert.equal(snippet.textDisplay, "great video");
  assert.equal(snippet.textOriginal, undefined);
});

test("textDisplay survives when it differs from textOriginal", () => {
  const raw = rawThread();
  raw.snippet.topLevelComment.snippet.textDisplay =
    '<a href="https://example.test">example.test</a>';
  const { snippet } = leanThread(raw).snippet.topLevelComment;
  assert.equal(snippet.textOriginal, "See example.test");
  assert.equal(
    snippet.textDisplay,
    '<a href="https://example.test">example.test</a>'
  );
});

test("a thread with no inlined replies emits no replies key", () => {
  assert.equal("replies" in leanThread(rawThread()), false);
});

test("absent optional fields are omitted, not invented", () => {
  const raw = rawThread();
  delete raw.snippet.videoId;
  delete raw.snippet.canReply;
  delete raw.snippet.topLevelComment.snippet.authorChannelId;
  delete raw.snippet.topLevelComment.snippet.updatedAt;
  const lean = leanThread(raw);
  assert.equal("videoId" in lean.snippet, false);
  assert.equal("canReply" in lean.snippet, false);
  assert.equal("authorChannelId" in lean.snippet.topLevelComment.snippet, false);
  assert.equal("updatedAt" in lean.snippet.topLevelComment.snippet, false);
});

test("leanComment keeps parentId on a reply", () => {
  const lean = leanComment({
    id: "reply-1",
    snippet: {
      textOriginal: "thanks",
      textDisplay: "thanks",
      authorDisplayName: "Owner Channel",
      authorChannelId: { value: CHANNEL },
      parentId: "comment-1",
      publishedAt: "2026-01-02T00:00:00Z",
    },
  });
  assert.equal(lean.snippet.parentId, "comment-1");
  assert.equal(lean.snippet.authorChannelId, CHANNEL);
});

test("the author predicate matches a reply the channel wrote in a viewer's thread", () => {
  const raw = rawThread();
  raw.snippet.topLevelComment.snippet.authorChannelId = { value: "UCviewer" };
  raw.replies = {
    comments: [
      {
        id: "reply-1",
        snippet: {
          textOriginal: "the link moved",
          authorDisplayName: "Owner Channel",
          authorChannelId: { value: CHANNEL },
          parentId: "comment-1",
          publishedAt: "2026-01-02T00:00:00Z",
        },
      },
    ],
  };
  assert.equal(threadAuthoredByChannel(raw, CHANNEL), true);
  assert.equal(leanThread(raw).replies.comments[0].id, "reply-1");
});

test("the author predicate rejects a thread with no comment from the channel", () => {
  const raw = rawThread();
  raw.snippet.topLevelComment.snippet.authorChannelId = { value: "UCviewer" };
  assert.equal(threadAuthoredByChannel(raw, CHANNEL), false);
  // An author-less comment must not match by absence.
  delete raw.snippet.topLevelComment.snippet.authorChannelId;
  assert.equal(threadAuthoredByChannel(raw, CHANNEL), false);
});
