import { useEffect, useRef } from "react";
import { useRouter } from "next/router";
import { authClient } from "@/lib/auth-client";
import { useToast } from "@/hooks/use-toast";
import Head from "next/head";

const SIGN_IN_REDIRECT_DELAY_MS = 500;
const FALLBACK_AUTH_ERROR_DESCRIPTION = "Authentication failed. Please try again.";

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function getSafeReturnTo(value: string | string[] | undefined) {
  const rawReturnTo = firstQueryValue(value);
  if (!rawReturnTo || !rawReturnTo.startsWith("/")) return null;

  let decodedReturnTo: string;
  try {
    decodedReturnTo = decodeURIComponent(rawReturnTo);
  } catch {
    return null;
  }

  if (
    !decodedReturnTo.startsWith("/") ||
    decodedReturnTo.startsWith("//") ||
    decodedReturnTo.includes("\\")
  ) {
    return null;
  }

  const parsedReturnTo = new URL(decodedReturnTo, "https://vidtempla.local");
  if (parsedReturnTo.origin !== "https://vidtempla.local") return null;

  return `${parsedReturnTo.pathname}${parsedReturnTo.search}${parsedReturnTo.hash}`;
}

export default function AuthCallback() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const { toast } = useToast();
  const redirectedRef = useRef(false);
  const signInRedirectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const userId = session?.user?.id;

  useEffect(() => {
    if (!router.isReady || redirectedRef.current) return;

    // Check for error parameters in URL
    const error = firstQueryValue(router.query.error);
    const errorDescription = firstQueryValue(router.query.error_description);
    const errorCode = firstQueryValue(router.query.error_code);

    if (error) {
      let displayDescription =
        errorDescription ?? FALLBACK_AUTH_ERROR_DESCRIPTION;
      if (
        errorCode === "signup_disabled" ||
        displayDescription.toLowerCase().includes("signups not allowed")
      ) {
        displayDescription = "Can't find an account associated with this email";
      }

      const params = new URLSearchParams({
        error,
        error_description: displayDescription,
        ...(errorCode && { error_code: errorCode }),
      });
      redirectedRef.current = true;
      router.push(`/sign-in?${params.toString()}`);
      return;
    }

    // If session check is done, redirect accordingly
    if (!isPending) {
      if (userId) {
        if (signInRedirectTimeoutRef.current) {
          clearTimeout(signInRedirectTimeoutRef.current);
          signInRedirectTimeoutRef.current = null;
        }
        toast({
          title: "Success",
          description: "You've been signed in!",
        });
        const returnTo = getSafeReturnTo(router.query.returnTo);
        redirectedRef.current = true;
        if (returnTo) {
          router.push(returnTo);
        } else {
          router.push("/org/resolve");
        }
      } else {
        signInRedirectTimeoutRef.current = setTimeout(() => {
          if (redirectedRef.current) return;

          signInRedirectTimeoutRef.current = null;
          router.push("/sign-in");
        }, SIGN_IN_REDIRECT_DELAY_MS);
      }
    }

    return () => {
      if (signInRedirectTimeoutRef.current) {
        clearTimeout(signInRedirectTimeoutRef.current);
        signInRedirectTimeoutRef.current = null;
      }
    };
  }, [router.isReady, isPending, userId]);

  return (
    <>
      <Head>
        <title>Completing Sign In...</title>
        <meta name="description" content="Completing your sign in" />
      </Head>
      <div className="bg-background flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="border-primary inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-r-transparent"></div>
          <p className="text-muted-foreground mt-4">Completing sign in...</p>
        </div>
      </div>
    </>
  );
}
