import type { Metadata } from "next";
import { GraphPage } from "@/components/pages/graph";

export const metadata: Metadata = { title: "Knowledge graph" };

export default function Page() {
  return <GraphPage />;
}
