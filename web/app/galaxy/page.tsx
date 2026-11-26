import type { Metadata } from "next";
import { GalaxyPage } from "@/components/pages/galaxy";

export const metadata: Metadata = { title: "Embedding galaxy" };

export default function Page() {
  return <GalaxyPage />;
}
