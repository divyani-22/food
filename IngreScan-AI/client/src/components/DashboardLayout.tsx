import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { getLoginUrl } from "@/const";
import { BrandMark } from "@/components/brand/BrandMark";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/useMobile";
import { LayoutDashboard, LogOut, PanelLeft, Scan, User, History, MessageSquare, Sparkles, Refrigerator, Barcode, Menu, Plus, ArrowRight, ClipboardCheck, ReceiptText } from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from './DashboardLayoutSkeleton';
import { Button } from "./ui/button";

const PATH_ALIASES: Record<string, string[]> = {
  "/fridge": ["/expiry"],
  "/openfoodfacts": ["/barcode"],
};

const menuItems = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard", group: "Overview" },
  { icon: Scan, label: "Packaged Scanner", path: "/scanner", group: "Scan" },
  { icon: Sparkles, label: "Fresh Produce AI", path: "/produce", group: "Scan" },
  { icon: Barcode, label: "Open Food Facts", path: "/openfoodfacts", group: "Scan" },
  { icon: Refrigerator, label: "Expiry Tracker", path: "/fridge", group: "Track" },
  { icon: ReceiptText, label: "Receipt import", path: "/receipt", group: "Track" },
  { icon: History, label: "History", path: "/history", group: "Track" },
  { icon: ClipboardCheck, label: "Batch QC", path: "/qc", group: "Business" },
  { icon: MessageSquare, label: "Chat", path: "/chat", group: "Assist" },
  { icon: User, label: "Profile", path: "/profile", group: "Assist" },
];
const menuGroups = ["Overview", "Scan", "Track", "Business", "Assist"] as const;

const isPathActive = (location: string, path: string) =>
  location === path || (PATH_ALIASES[path] ?? []).includes(location);

/** Mobile tab bar (Foodnoms Tab Bar: active = Ember Orange + dot, floating orange action). */
const tabItems = [
  { icon: LayoutDashboard, label: "Home", path: "/dashboard" },
  { icon: Sparkles, label: "Produce", path: "/produce" },
  { icon: Refrigerator, label: "Fridge", path: "/fridge" },
];

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const parsed = parseInt(localStorage.getItem(SIDEBAR_WIDTH_KEY) ?? "", 10);
      return Number.isFinite(parsed) && parsed >= MIN_WIDTH && parsed <= MAX_WIDTH
        ? parsed
        : DEFAULT_WIDTH;
    } catch {
      return DEFAULT_WIDTH;
    }
  });
  const { loading, user } = useAuth();

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
    } catch {
      // ignore
    }
  }, [sidebarWidth]);

  if (loading) {
    return <DashboardLayoutSkeleton />
  }

  if (!user) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-fog px-4">
        <div className="w-full max-w-md rounded-3xl bg-white p-8 sm:p-10">
          <BrandMark />
          <h1 className="fn-heading mt-8 text-graphite">
            <span className="text-verdant-green">Welcome back.</span> Sign in to keep scanning.
          </h1>
          <p className="mt-3 text-base text-muted-foreground">
            Your scans, fridge inventory and health profile are waiting.
          </p>
          <Button
            onClick={() => {
              window.location.href = getLoginUrl();
            }}
            size="lg"
            className="mt-8 w-full"
          >
            Sign in
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

type DashboardLayoutContentProps = {
  children: React.ReactNode;
  setSidebarWidth: (width: number) => void;
};

function DashboardLayoutContent({
  children,
  setSidebarWidth,
}: DashboardLayoutContentProps) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const activeMenuItem = menuItems.find(item => isPathActive(location, item.path));
  const isMobile = useIsMobile();

  useEffect(() => {
    if (isCollapsed) {
      setIsResizing(false);
    }
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  const { setOpenMobile } = useSidebar();
  const goTo = (path: string) => {
    setLocation(path);
    setOpenMobile(false);
  };

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar
          collapsible="icon"
          className="border-r border-sidebar-border"
          disableTransition={isResizing}
        >
          <SidebarHeader className="h-[72px] justify-center px-3">
            <div className="flex w-full items-center gap-2 transition-all group-data-[collapsible=icon]:justify-center">
              {isCollapsed ? (
                <button
                  onClick={toggleSidebar}
                  className="group relative grid h-9 w-9 place-items-center rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Expand sidebar"
                >
                  <BrandMark showWordmark={false} className="transition-opacity group-hover:opacity-0" />
                  <PanelLeft className="absolute h-4 w-4 text-graphite opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              ) : (
                <>
                  <button onClick={() => goTo("/")} className="min-w-0 rounded-xl text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <BrandMark />
                  </button>
                  <button
                    onClick={toggleSidebar}
                    className="ml-auto grid h-9 w-9 shrink-0 place-items-center rounded-full transition-colors hover:bg-fog focus:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:hidden"
                    aria-label="Collapse sidebar"
                  >
                    <PanelLeft className="h-4 w-4 text-muted-foreground" />
                  </button>
                </>
              )}
            </div>
          </SidebarHeader>

          <SidebarContent role="navigation" aria-label="Main" className="gap-1 px-1">
            {menuGroups.map(group => (
              <SidebarGroup key={group} className="py-1">
                <SidebarGroupLabel className="px-3 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                  {group}
                </SidebarGroupLabel>
                <SidebarMenu className="gap-0.5">
                  {menuItems
                    .filter(item => item.group === group)
                    .map(item => {
                      const isActive = isPathActive(location, item.path);
                      return (
                        <SidebarMenuItem key={item.path}>
                          <SidebarMenuButton
                            isActive={isActive}
                            aria-current={isActive ? "page" : undefined}
                            onClick={() => goTo(item.path)}
                            tooltip={item.label}
                            className="h-11"
                          >
                            <item.icon
                              className={cn(isActive ? "text-ember-orange" : "text-muted-foreground")}
                              strokeWidth={isActive ? 2.5 : 2}
                            />
                            <span>{item.label}</span>
                            {isActive && (
                              <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-ember-orange group-data-[collapsible=icon]:hidden" aria-hidden="true" />
                            )}
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                </SidebarMenu>
              </SidebarGroup>
            ))}
          </SidebarContent>

          <SidebarFooter className="p-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex w-full items-center gap-3 rounded-3xl bg-fog px-2 py-2 text-left transition-colors hover:bg-[#ebebeb] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:p-0">
                  <Avatar className="h-9 w-9 shrink-0">
                    <AvatarFallback className="bg-graphite text-xs font-bold text-white">
                      {user?.name?.charAt(0).toUpperCase() || "U"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                    <p className="truncate text-sm font-bold leading-none text-graphite">
                      {user?.name || "-"}
                    </p>
                    <p className="mt-1.5 truncate text-xs text-muted-foreground">
                      {user?.email || "-"}
                    </p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  onClick={logout}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Sign out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>
        <div
          className={`absolute top-0 right-0 h-full w-1 cursor-col-resize transition-colors hover:bg-ember-orange/30 ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => {
            if (isCollapsed) return;
            setIsResizing(true);
          }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset id="main-content" tabIndex={-1} className="min-h-[100dvh] bg-fog">
        {isMobile && (
          <div className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-border bg-white/90 px-4 backdrop-blur supports-[backdrop-filter]:bg-white/80">
            <button onClick={() => goTo("/")} className="flex h-11 min-w-0 items-center rounded-xl">
              <BrandMark size="sm" />
            </button>
          </div>
        )}
        <div className={cn("mx-auto w-full max-w-[1200px] flex-1 px-4 py-6 sm:px-6 md:px-10 md:py-10", isMobile && "pb-32")}>
          {children}
        </div>

        {isMobile && (
          <nav
            aria-label="Primary"
            className="fn-safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-border bg-white"
          >
            <div className="relative mx-auto grid h-16 max-w-md grid-cols-5 items-center">
              {tabItems.slice(0, 2).map(item => (
                <TabButton key={item.path} item={item} active={isPathActive(location, item.path)} onClick={() => goTo(item.path)} />
              ))}
              <div className="flex justify-center">
                <button
                  onClick={() => goTo("/scanner")}
                  aria-label="Scan packaged food"
                  className="-mt-8 grid h-14 w-14 place-items-center rounded-full bg-ember-orange text-white ring-4 ring-white transition-transform active:scale-95 focus:outline-none focus-visible:ring-graphite"
                >
                  <Plus className="h-7 w-7" strokeWidth={2.75} />
                </button>
              </div>
              <TabButton item={tabItems[2]} active={isPathActive(location, tabItems[2].path)} onClick={() => goTo(tabItems[2].path)} />
              <TabButton item={{ icon: Menu, label: "More", path: "" }} active={false} onClick={() => setOpenMobile(true)} />
            </div>
          </nav>
        )}
      </SidebarInset>
    </>
  );
}

function TabButton({
  item,
  active,
  onClick,
}: {
  item: { icon: typeof Menu; label: string; path: string };
  active: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className="flex h-full flex-col items-center justify-center gap-1 focus:outline-none focus-visible:bg-fog"
    >
      <Icon className={cn("h-[22px] w-[22px]", active ? "text-ember-orange" : "text-muted-foreground")} strokeWidth={active ? 2.5 : 2} />
      <span className={cn("text-[11px] font-bold leading-none", active ? "text-graphite" : "text-muted-foreground")}>{item.label}</span>
      <span className={cn("h-1 w-1 rounded-full", active ? "bg-ember-orange" : "bg-transparent")} aria-hidden="true" />
    </button>
  );
}
