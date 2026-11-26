import type { Metadata } from "next";
import { PipelinePage } from "@/components/pages/pipeline";

export const metadata: Metadata = { title: "Pipeline" };

export default function Page() {
  return <PipelinePage />;
}
