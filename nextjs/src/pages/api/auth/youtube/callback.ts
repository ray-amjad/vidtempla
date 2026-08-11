/**
 * YouTube OAuth callback handler
 * Exchanges authorization code for tokens and stores channel info
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { auth } from '@/lib/auth';
import { fromNodeHeaders } from 'better-auth/node';
import {
  exchangeCodeForTokens,
  fetchChannelInfo,
} from '@/lib/clients/youtube';
import { encrypt } from '@/utils/encryption';
import {
  YOUTUBE_OAUTH_STATE_COOKIE,
  clearStateCookie,
  verifyOAuthState,
} from '@/lib/youtube-oauth-state';
import { checkChannelLimit } from '@/lib/plan-limits';
import { start } from 'workflow/api';
import { syncChannelVideosWorkflow } from '@/workflows/sync-channel-videos';
import { db } from '@/db';
import { youtubeChannels, member } from '@/db/schema';
import { eq } from 'drizzle-orm';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { code, error, state } = req.query;

    // The state is single-use: clear it on every outcome, including failures.
    const stateCookie = req.cookies[YOUTUBE_OAUTH_STATE_COOKIE];
    res.setHeader('Set-Cookie', clearStateCookie());

    // Handle OAuth errors
    if (error) {
      console.error('OAuth error:', error);
      return res.redirect(
        '/dashboard/youtube?error=' + encodeURIComponent(error as string)
      );
    }

    if (!code || typeof code !== 'string') {
      return res.redirect(
        '/dashboard/youtube?error=no_code'
      );
    }

    // Reject any authorization response that did not originate from our own
    // initiation endpoint in this browser.
    if (
      !verifyOAuthState(typeof state === 'string' ? state : null, stateCookie)
    ) {
      return res.redirect(
        '/dashboard/youtube?error=' +
          encodeURIComponent(
            'Could not verify the connection request. Please try connecting your channel again.'
          )
      );
    }

    // Get current user via Better Auth
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session) {
      return res.redirect('/sign-in?redirect=/dashboard/youtube');
    }

    // Resolve user's active organization (use session's active org or first membership)
    let organizationId = session.session?.activeOrganizationId ?? null;
    if (!organizationId) {
      const [membership] = await db
        .select({ organizationId: member.organizationId })
        .from(member)
        .where(eq(member.userId, session.user.id))
        .limit(1);
      organizationId = membership?.organizationId ?? null;
    }

    if (!organizationId) {
      return res.redirect('/dashboard/youtube?error=' + encodeURIComponent('No organization found. Please set up your account first.'));
    }

    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code);

    // Fetch channel info
    const channelInfo = await fetchChannelInfo(tokens.access_token);

    // Calculate token expiry
    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + tokens.expires_in);

    // Encrypt tokens
    const encryptedAccessToken = encrypt(tokens.access_token);
    const encryptedRefreshToken = tokens.refresh_token
      ? encrypt(tokens.refresh_token)
      : null;

    // Check if channel already exists
    const [existingChannel] = await db
      .select({ id: youtubeChannels.id })
      .from(youtubeChannels)
      .where(eq(youtubeChannels.channelId, channelInfo.id));

    if (existingChannel) {
      // Update existing channel (re-authentication)
      await db
        .update(youtubeChannels)
        .set({
          accessTokenEncrypted: encryptedAccessToken,
          refreshTokenEncrypted: encryptedRefreshToken,
          tokenExpiresAt: expiresAt,
          tokenStatus: 'valid', // Reset token status on re-authentication
          title: channelInfo.snippet.title,
          thumbnailUrl: channelInfo.snippet.thumbnails.high.url,
          subscriberCount: parseInt(channelInfo.statistics.subscriberCount),
        })
        .where(eq(youtubeChannels.id, existingChannel.id));

      // Trigger automatic sync for reconnected channel
      await start(syncChannelVideosWorkflow, [
        existingChannel.id,
        session.user.id,
      ]);
    } else {
      // Check channel limit before adding a new channel
      const limitCheck = await checkChannelLimit(organizationId, db);

      if (!limitCheck.canAddChannel) {
        return res.redirect(
          `/dashboard/youtube?error=${encodeURIComponent(
            `Channel limit reached (${limitCheck.limit} ${limitCheck.limit === 1 ? 'channel' : 'channels'} on ${limitCheck.planTier} plan). Please upgrade to add more channels.`
          )}`
        );
      }

      // Insert new channel
      const [newChannel] = await db
        .insert(youtubeChannels)
        .values({
          userId: session.user.id,
          organizationId,
          channelId: channelInfo.id,
          title: channelInfo.snippet.title,
          thumbnailUrl: channelInfo.snippet.thumbnails.high.url,
          subscriberCount: parseInt(channelInfo.statistics.subscriberCount),
          accessTokenEncrypted: encryptedAccessToken,
          refreshTokenEncrypted: encryptedRefreshToken,
          tokenExpiresAt: expiresAt,
        })
        .returning({ id: youtubeChannels.id });

      // Trigger automatic sync for newly connected channel
      if (newChannel) {
        await start(syncChannelVideosWorkflow, [
          newChannel.id,
          session.user.id,
        ]);
      }
    }

    // Redirect to YouTube dashboard page with success message
    return res.redirect('/dashboard/youtube?success=true');
  } catch (error) {
    console.error('Error in YouTube OAuth callback:', error);
    return res.redirect(
      '/dashboard/youtube?error=' +
        encodeURIComponent(
          error instanceof Error ? error.message : 'Unknown error'
        )
    );
  }
}
