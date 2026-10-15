import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import "./index.css";

/**
 * Input validation failures reach the client as a JSON array of zod issues. Rewrite such a message in place into a
 * readable sentence so every toast and inline error that shows `error.message` stays readable.
 */
export function readableErrorMessage(message: string): string {
  if (!message.startsWith("[")) return message;
  try {
    const issues = JSON.parse(message);
    if (!Array.isArray(issues) || issues.length === 0) return message;
    const parts = issues
      .filter((i): i is { message: string; path?: unknown[] } => !!i && typeof i.message === "string")
      .map((i) => {
        const field = Array.isArray(i.path) && i.path.length > 0 ? String(i.path[i.path.length - 1]) : "";
        const label = field && !/^\d+$/.test(field) ? field.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase() : "";
        return label ? `${label.charAt(0).toUpperCase()}${label.slice(1)}: ${i.message}` : i.message;
      });
    return parts.length > 0 ? parts.join(". ") : message;
  } catch {
    return message;
  }
}

const humanizeError = (error: unknown) => {
  if (error instanceof TRPCClientError) {
    try {
      error.message = readableErrorMessage(error.message);
    } catch {
      // read-only message: keep the original
    }
  }
};

// The cache-level onError runs before any per-hook onError / mutateAsync rejection handler, so components see the
// readable text.
const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: humanizeError }),
  mutationCache: new MutationCache({ onError: humanizeError }),
});

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  const loginUrl = getLoginUrl();
  // Avoid an endless reload loop when the login URL is the current page
  // (getLoginUrl falls back to "/dashboard" when no OAuth portal is configured).
  try {
    const target = new URL(loginUrl, window.location.origin);
    if (
      target.origin === window.location.origin &&
      target.pathname === window.location.pathname
    ) {
      return;
    }
  } catch {
    // fall through to redirect
  }
  window.location.href = loginUrl;
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
