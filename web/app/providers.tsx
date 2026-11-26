"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useApp } from "@/lib/store";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { TooltipProvider } from "@/components/ui/primitives";

gsap.registerPlugin(useGSAP);

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    useApp.persist.rehydrate();
  }, []);
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 5 * 60_000, refetchOnWindowFocus: false, retry: 1 } },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={150}>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}
