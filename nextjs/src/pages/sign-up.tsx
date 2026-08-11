import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/hooks/useUser";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { appConfig } from "@/config/app";
import Link from "next/link";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { getSafeReturnTo } from "@/utils/safeReturnTo";

const btnStyle: React.CSSProperties = {
  fontFamily: "'Bricolage Grotesque', sans-serif",
  fontWeight: 700,
  fontSize: 16,
  lineHeight: 1,
  border: "none",
  borderRadius: 999,
  cursor: "pointer",
  width: "100%",
  padding: "14px 24px",
  transition: "transform 0.15s, box-shadow 0.15s",
};

export default function Page() {
  const router = useRouter();
  const { user, loading: userLoading } = useUser();
  const { toast } = useToast();

  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  useEffect(() => {
    if (user && !userLoading) {
      const returnTo = getSafeReturnTo(router.query.returnTo);
      router.push(returnTo ?? "/org/resolve");
    }
  }, [user, userLoading]);

  if (!appConfig.auth.enableSignUp) {
    return (
      <AuthLayout title="Sign Up Disabled" headTitle="Sign Up | VidTempla">
        <p
          style={{
            fontSize: 16,
            color: "var(--text-light)",
            marginBottom: 24,
          }}
        >
          Account creation is currently disabled. Please contact an
          administrator.
        </p>
        <button
          onClick={() => router.push("/sign-in")}
          style={{
            ...btnStyle,
            background: "var(--terracotta)",
            color: "white",
          }}
        >
          Go to Sign In
        </button>
      </AuthLayout>
    );
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const { error } = await authClient.signIn.magicLink({
        email,
        callbackURL: "/dashboard/youtube",
      });
      if (error) {
        toast({
          variant: "destructive",
          title: "Sign up failed",
          description: error.message,
        });
      } else {
        setMagicLinkSent(true);
        toast({
          title: "Magic link sent",
          description: "Check your email for the login link!",
        });
      }
    } catch {
      toast({
        variant: "destructive",
        title: "Error",
        description: "An unexpected error occurred. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleGoogleSignIn() {
    setGoogleLoading(true);
    try {
      await authClient.signIn.social({
        provider: "google",
        callbackURL: "/dashboard/youtube",
      });
    } catch {
      toast({
        variant: "destructive",
        title: "Error",
        description: "An unexpected error occurred. Please try again.",
      });
      setGoogleLoading(false);
    }
  }

  if (userLoading || user) {
    return (
      <AuthLayout title="Sign Up" headTitle="Sign Up | VidTempla">
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
            padding: "24px 0",
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              border: "3px solid var(--cream-dark)",
              borderTopColor: "var(--teal)",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }}
          />
          <style jsx>{`
            @keyframes spin {
              to {
                transform: rotate(360deg);
              }
            }
          `}</style>
          <p style={{ fontSize: 15, color: "var(--text-light)" }}>
            Redirecting...
          </p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Create Account" headTitle="Sign Up | VidTempla">
      {!magicLinkSent ? (
        <form onSubmit={handleSignUp}>
          <div style={{ marginBottom: 20 }}>
            <label
              htmlFor="email"
              style={{
                display: "block",
                fontFamily: "'Bricolage Grotesque', sans-serif",
                fontSize: 14,
                fontWeight: 600,
                color: "var(--text)",
                marginBottom: 6,
              }}
            >
              Email address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={{
                width: "100%",
                padding: "12px 16px",
                fontSize: 16,
                fontFamily: "'Source Serif 4', Georgia, serif",
                border: "2px solid var(--cream-dark)",
                borderRadius: 12,
                background: "var(--cream)",
                color: "var(--text)",
                outline: "none",
                transition: "border-color 0.15s",
              }}
              onFocus={(e) =>
                (e.target.style.borderColor = "var(--teal-light)")
              }
              onBlur={(e) =>
                (e.target.style.borderColor = "var(--cream-dark)")
              }
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            style={{
              ...btnStyle,
              background: "var(--terracotta)",
              color: "white",
              opacity: isSubmitting ? 0.7 : 1,
              marginBottom: 16,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-1px)";
              e.currentTarget.style.boxShadow =
                "0 4px 12px rgba(199,92,46,0.3)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "none";
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            {isSubmitting ? "Sending link..." : "Send Magic Link"}
          </button>

          {/* Divider */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              margin: "20px 0",
            }}
          >
            <div
              style={{ flex: 1, height: 1, background: "var(--cream-dark)" }}
            />
            <span
              style={{
                fontSize: 14,
                color: "var(--text-light)",
                fontFamily: "'Bricolage Grotesque', sans-serif",
              }}
            >
              or
            </span>
            <div
              style={{ flex: 1, height: 1, background: "var(--cream-dark)" }}
            />
          </div>

          {/* Google button */}
          <button
            type="button"
            disabled={googleLoading}
            onClick={handleGoogleSignIn}
            style={{
              ...btnStyle,
              background: "white",
              color: "var(--text)",
              border: "2px solid var(--cream-dark)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              opacity: googleLoading ? 0.7 : 1,
              marginBottom: 24,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--teal-light)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--cream-dark)";
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            {googleLoading ? "Signing in..." : "Continue with Google"}
          </button>

          <p
            style={{
              textAlign: "center",
              fontSize: 15,
              color: "var(--text-light)",
            }}
          >
            Already have an account?{" "}
            <Link
              href="/sign-in"
              style={{ color: "var(--terracotta)", fontWeight: 600 }}
            >
              Sign in
            </Link>
          </p>
        </form>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 16,
            padding: "16px 0",
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              background: "var(--cream)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg
              width="32"
              height="32"
              fill="none"
              viewBox="0 0 24 24"
              stroke="var(--teal)"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
          </div>
          <h3
            style={{
              fontFamily: "'Bricolage Grotesque', sans-serif",
              fontSize: 22,
              fontWeight: 700,
              color: "var(--teal)",
            }}
          >
            Check your email
          </h3>
          <p
            style={{
              textAlign: "center",
              fontSize: 16,
              color: "var(--text-light)",
            }}
          >
            We sent a magic link to{" "}
            <strong style={{ color: "var(--text)" }}>{email}</strong>
          </p>
          <p
            style={{
              textAlign: "center",
              fontSize: 14,
              color: "var(--text-light)",
            }}
          >
            Click the link in your email to create your account.
          </p>
          <button
            onClick={() => setMagicLinkSent(false)}
            style={{
              background: "none",
              border: "none",
              color: "var(--terracotta)",
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "'Bricolage Grotesque', sans-serif",
              marginTop: 8,
            }}
          >
            Use a different email
          </button>
        </div>
      )}
    </AuthLayout>
  );
}
