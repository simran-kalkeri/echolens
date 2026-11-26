"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import {
  Activity,
  BellRing,
  Boxes,
  FlaskConical,
  LayoutGrid,
  Menu,
  Orbit,
  Share2,
  Sparkles,
  TableProperties,
  Workflow,
  X,
} from "lucide-react";
import { cn } from "@/lib/format";
import { useAlerts } from "@/lib/queries";
import { USING_MOCK } from "@/lib/api";
import { TopBar } from "./top-bar";
import { BrandMark } from "./brand";

const NAV = [
  {
    group: "Insights",
    items: [
      { href: "/", label: "Overview", icon: LayoutGrid },
      { href: "/themes", label: "Themes", icon: Boxes },
      { href: "/alerts", label: "Emerging issues", icon: BellRing, badge: "alerts" as const },
      { href: "/analyst", label: "AI analyst", icon: Sparkles },
      { href: "/explorer", label: "Feedback explorer", icon: TableProperties },
    ],
  },
  {
    group: "Explore",
    items: [
      { href: "/graph", label: "Knowledge graph", icon: Share2 },
      { href: "/galaxy", label: "Embedding galaxy", icon: Orbit },
    ],
  },
  {
    group: "System",
    items: [
      { href: "/pipeline", label: "Pipeline", icon: Workflow },
      { href: "/eval", label: "Evaluation", icon: FlaskConical },
    ],
  },
];

export const PAGE_TITLES: Record<string, string> = Object.fromEntries(NAV.flatMap((g) => g.items.map((i) => [i.href, i.label])));

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const alerts = useAlerts();
  const openCount = alerts.data?.length ?? 0;
  return (
    <nav className="flex flex-col gap-5 px-3" aria-label="Main">
      {NAV.map((g) => (
        <div key={g.group}>
          <div className="px-2 pb-1.5 text-2xs font-medium tracking-wide text-fg-3 uppercase">{g.group}</div>
          <ul className="flex flex-col gap-px">
            {g.items.map((item) => {
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors",
                      active ? "bg-hover text-fg" : "text-fg-2 hover:bg-hover/60 hover:text-fg",
                    )}
                  >
                    {active && <span className="absolute top-1.5 bottom-1.5 -left-3 w-[2px] rounded-r bg-accent" />}
                    <Icon className={cn("size-4 shrink-0", active ? "text-accent" : "text-fg-3 group-hover:text-fg-2")} strokeWidth={1.75} />
                    <span className="truncate">{item.label}</span>
                    {item.badge === "alerts" && openCount > 0 && (
                      <span className="ml-auto rounded-sm bg-[#e5484d]/15 px-1.5 text-2xs font-medium text-[#f2777b] tnum">{openCount}</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function SidebarFooter() {
  return (
    <div className="mx-3 mb-3 rounded-lg border border-border bg-raised/60 p-3">
      <div className="flex items-center gap-2 text-xs text-fg-2">
        <Activity className="size-3.5 text-pos" strokeWidth={2} />
        <span>Pipeline healthy</span>
      </div>
      <p className="mt-1 text-2xs leading-4 text-fg-3">
        Last run Jul 1, 2022 · 51m 43s
        <br />
        {USING_MOCK ? "Serving mock data (no API URL)" : "Connected to API"}
      </p>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setMobileOpen(false), [pathname]);

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-panel/40 lg:flex">
        <div className="flex h-14 items-center gap-2.5 px-5">
          <BrandMark />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pt-2">
          <NavList />
        </div>
        <SidebarFooter />
      </aside>

      <Dialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 lg:hidden" />
          <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-border bg-panel outline-none lg:hidden">
            <Dialog.Title className="sr-only">Navigation</Dialog.Title>
            <Dialog.Description className="sr-only">Main navigation</Dialog.Description>
            <div className="flex h-14 items-center justify-between px-5">
              <BrandMark />
              <Dialog.Close className="grid size-9 place-items-center rounded-md text-fg-3 hover:bg-hover hover:text-fg" aria-label="Close navigation">
                <X className="size-4" />
              </Dialog.Close>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pt-2">
              <NavList onNavigate={() => setMobileOpen(false)} />
            </div>
            <SidebarFooter />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          menuButton={
            <button
              onClick={() => setMobileOpen(true)}
              className="grid size-9 place-items-center rounded-md text-fg-2 hover:bg-hover hover:text-fg lg:hidden"
              aria-label="Open navigation"
            >
              <Menu className="size-[18px]" />
            </button>
          }
        />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
