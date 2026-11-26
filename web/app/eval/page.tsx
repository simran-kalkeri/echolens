import type { Metadata } from "next";
import { EvalPage } from "@/components/pages/eval";

export const metadata: Metadata = { title: "Evaluation" };

export default function Page() {
  return <EvalPage />;
}
