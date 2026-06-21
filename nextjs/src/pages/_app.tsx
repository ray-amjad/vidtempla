import { useEffect } from "react";
import Script from "next/script";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import RootLayout from "@/components/layout/RootLayout";
import { Toaster } from "@/components/ui/toaster";
import { useUser } from "@/hooks/useUser";
import { AppProps } from "next/app";
import "../styles/globals.css";
import { api } from "../utils/api";

function App({ Component, pageProps }: AppProps) {
  const { user } = useUser();

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_POSTHOG_KEY) {
      posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
        api_host: "/ingest",
        ui_host: "https://us.posthog.com",
        defaults: "2025-05-24",
        capture_exceptions: true, // This enables capturing exceptions using Error Tracking, set to false if you don't want this
        debug: process.env.NODE_ENV === "development",
      });
    }
  }, []);

  return (
    <PostHogProvider client={posthog}>
      <RootLayout>
        <div className="min-h-screen">
          <Component {...pageProps} />
          <Toaster />
        </div>
      </RootLayout>

      {/* AgentStack Widget */}
      <Script id="agentstack-init" strategy="lazyOnload">
        {`window.agentstack=new Proxy({_q:[]},{get(t,p){if(p==='_q')return t._q;return(...a)=>t._q.push([p,...a]);}});`}
      </Script>
      <Script
        src="https://www.agentstack.build/embed.js"
        data-agent-id="xlb0EGyfRIce"
        strategy="lazyOnload"
      />
    </PostHogProvider>
  );
}

export default api.withTRPC(App);
