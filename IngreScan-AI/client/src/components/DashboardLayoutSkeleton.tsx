import { Skeleton } from './ui/skeleton';

export function DashboardLayoutSkeleton() {
  return (
    <div className="flex min-h-[100dvh] bg-fog">
      {/* Sidebar skeleton (desktop only — phones use the bottom tab bar) */}
      <aside className="relative hidden w-[280px] shrink-0 flex-col border-r border-border bg-white p-3 md:flex">
        {/* Logo area */}
        <div className="flex h-[72px] items-center gap-2.5 px-2">
          <Skeleton className="h-9 w-9 rounded-xl bg-fog" />
          <Skeleton className="h-4 w-28 rounded-3xl bg-fog" />
        </div>

        {/* Menu items */}
        <div className="mt-2 space-y-2 px-1">
          <Skeleton className="mx-2 h-3 w-16 rounded-3xl bg-fog" />
          <Skeleton className="h-11 w-full rounded-3xl bg-fog" />
          <Skeleton className="h-11 w-full rounded-3xl bg-fog" />
          <Skeleton className="h-11 w-full rounded-3xl bg-fog" />
          <Skeleton className="h-11 w-full rounded-3xl bg-fog" />
        </div>

        {/* User profile area at bottom */}
        <div className="mt-auto">
          <div className="flex items-center gap-3 rounded-3xl bg-fog px-2 py-2">
            <Skeleton className="h-9 w-9 rounded-full bg-[#ebebeb]" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-20 rounded-3xl bg-[#ebebeb]" />
              <Skeleton className="h-2 w-32 rounded-3xl bg-[#ebebeb]" />
            </div>
          </div>
        </div>
      </aside>

      {/* Main content skeleton */}
      <div className="min-w-0 flex-1">
        {/* Mobile top bar */}
        <div className="flex h-16 items-center gap-2.5 border-b border-border bg-white px-4 md:hidden">
          <Skeleton className="h-9 w-9 rounded-xl bg-fog" />
          <Skeleton className="h-4 w-28 rounded-3xl bg-fog" />
        </div>
        <div className="mx-auto w-full max-w-[1200px] space-y-8 px-4 py-6 sm:px-6 md:space-y-10 md:px-10 md:py-10">
          {/* Page header */}
          <div className="space-y-3">
            <Skeleton className="h-3.5 w-24 rounded-3xl bg-white" />
            <Skeleton className="h-8 w-64 max-w-full rounded-3xl bg-white" />
            <Skeleton className="h-4 w-96 max-w-full rounded-3xl bg-white" />
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-36 rounded-3xl bg-white" />
            <Skeleton className="h-36 rounded-3xl bg-white" />
            <Skeleton className="h-36 rounded-3xl bg-white" />
          </div>
          <Skeleton className="h-72 rounded-3xl bg-white" />
        </div>
      </div>
    </div>
  );
}
