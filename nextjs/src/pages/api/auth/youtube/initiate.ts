/**
 * YouTube OAuth initiation endpoint
 * Redirects user to Google OAuth consent screen
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { auth } from '@/lib/auth';
import { fromNodeHeaders } from 'better-auth/node';
import { getOAuthUrl } from '@/lib/clients/youtube';
import {
  createOAuthState,
  serializeStateCookie,
} from '@/lib/youtube-oauth-state';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Only a signed-in user may start a channel connection. The callback needs a
  // session anyway, so an anonymous caller could never finish this flow.
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });

  if (!session) {
    return res.redirect(
      '/sign-in?returnTo=' + encodeURIComponent('/dashboard/youtube')
    );
  }

  try {
    // Bind this authorization request to the caller's browser so the callback
    // can reject an authorization response the caller did not start.
    const { state, cookieValue } = createOAuthState();
    res.setHeader('Set-Cookie', serializeStateCookie(cookieValue));

    const authUrl = getOAuthUrl(state);
    return res.redirect(authUrl);
  } catch (error) {
    console.error('Error initiating YouTube OAuth:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
