import type { Metadata } from "next";
import { ExplorerPage } from "@/components/pages/explorer";

export const metadata: Metadata = { title: "Feedback explorer" };

export default function Page() {
  return <ExplorerPage />;
}
