import { BrandMark } from "@/components/brand/BrandMark";
import { Button } from "@/components/ui/button";
import { Home, SearchX } from "lucide-react";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, setLocation] = useLocation();

  const handleGoHome = () => {
    setLocation("/");
  };

  return (
    <div className="flex min-h-[100dvh] w-full flex-col bg-fog">
      <header className="flex h-16 items-center px-4 sm:px-6 md:px-10">
        <BrandMark />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-lg rounded-3xl bg-white px-6 py-10 text-center sm:px-10 sm:py-12">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-fog">
            <SearchX className="h-8 w-8 text-ember-orange" />
          </span>

          <p className="fn-metric mt-6 text-5xl text-ember-orange">404</p>

          <h1 className="fn-heading mt-3 text-graphite">Page Not Found</h1>

          <p className="mt-3 text-base leading-relaxed text-muted-foreground">
            Sorry, the page you are looking for doesn't exist.
            <br />
            It may have been moved or deleted.
          </p>

          <div id="not-found-button-group" className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Button size="lg" onClick={handleGoHome} className="w-full sm:w-auto">
              <Home className="h-4 w-4" />
              Go Home
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
