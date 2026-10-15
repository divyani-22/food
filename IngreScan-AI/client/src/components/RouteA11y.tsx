import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";

const APP = "IngreScan-AI";

/** Page names by route, used for document.title and the route-change announcement. */
const TITLES: Array<[RegExp, string]> = [
  [/^\/$/, "Know what you eat"],
  [/^\/dashboard$/, "Dashboard"],
  [/^\/scanner$/, "Packaged food scanner"],
  [/^\/produce$/, "Fresh produce AI"],
  [/^\/(fridge|expiry)$/, "Expiry tracker"],
  [/^\/qc$/, "Batch quality control"],
  [/^\/receipt$/, "Receipt import"],
  [/^\/(openfoodfacts|barcode)$/, "Open Food Facts"],
  [/^\/profile$/, "Health profile"],
  [/^\/scan\/[^/]+$/, "Scan result"],
  [/^\/history$/, "Scan history"],
  [/^\/chat$/, "Chat"],
  [/^\/privacy$/, "Privacy policy"],
  [/^\/terms$/, "Terms of service"],
  [/^\/about$/, "About"],
];

export function titleForPath(path: string): string {
  const hit = TITLES.find(([re]) => re.test(path));
  return hit ? hit[1] : "Page not found";
}

/**
 * Keeps document.title in sync with the route (WCAG 2.4.2) and announces route changes to screen readers through a
 * polite live region (the SPA never reloads, so assistive tech would otherwise hear nothing). Also renders the
 * "Skip to main content" link, the first Tab stop on every page (WCAG 2.4.1).
 */
export function RouteA11y() {
  const [path] = useLocation();
  const [announcement, setAnnouncement] = useState("");
  const first = useRef(true);

  useEffect(() => {
    const name = titleForPath(path);
    document.title = path === "/" ? `${APP} - ${name}` : `${name} - ${APP}`;
    if (first.current) {
      first.current = false;
      return;
    }
    setAnnouncement(name);
  }, [path]);

  return (
    <>
      <a href="#main-content" className="fn-skip-link">
        Skip to main content
      </a>
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="route-announcer">
        {announcement}
      </div>
    </>
  );
}
