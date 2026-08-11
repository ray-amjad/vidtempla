import { useRouter } from "next/router";
import { useState } from "react";
import Head from "next/head";
import type { GetServerSideProps, InferGetServerSidePropsType } from "next";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { oauthApplication } from "@/db/schema";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { getSafeRedirectUri } from "@/utils/safeRedirectUri";

export const getServerSideProps: GetServerSideProps<{
  clientName: string;
}> = async (ctx) => {
  const clientId = ctx.query.client_id as string | undefined;
  let clientName = "An application";
  if (clientId) {
    const app = await db
      .select({ name: oauthApplication.name })
      .from(oauthApplication)
      .where(eq(oauthApplication.clientId, clientId))
      .then((rows) => rows[0]);
    if (app?.name) {
      clientName = app.name;
    }
  }
  return { props: { clientName } };
};

export default function ConsentPage({
  clientName,
}: InferGetServerSidePropsType<typeof getServerSideProps>) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const handleConsent = async (accept: boolean) => {
    setIsLoading(true);
    try {
      const consentCode = router.query.consent_code as string;
      const res = await authClient.$fetch("/oauth2/consent", {
        method: "POST",
        body: { accept, consent_code: consentCode },
      });
      const data = res.data as { redirectURI?: string } | undefined;
      const redirectUri = getSafeRedirectUri(data?.redirectURI);
      if (redirectUri) {
        window.location.href = redirectUri;
      } else {
        setIsLoading(false);
      }
    } catch {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Authorize | VidTempla</title>
      </Head>
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-2 text-center">
            <h1 className="text-2xl font-bold">Authorize Access</h1>
            <p className="text-muted-foreground">
              <span className="font-medium text-foreground">{clientName}</span>{" "}
              wants to access your VidTempla account.
            </p>
          </div>

          <div className="space-y-2 rounded-lg border bg-card p-4">
            <p className="text-sm font-medium">This will allow access to:</p>
            <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
              <li>Your YouTube channels and videos</li>
              <li>Your templates and containers</li>
              <li>Channel and video analytics</li>
            </ul>
          </div>

          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => handleConsent(false)}
              disabled={isLoading}
            >
              Deny
            </Button>
            <Button
              className="flex-1"
              onClick={() => handleConsent(true)}
              disabled={isLoading}
            >
              {isLoading ? "Authorizing..." : "Authorize"}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
