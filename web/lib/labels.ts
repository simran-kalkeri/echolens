import type { AspectId, Intent, Sentiment, Source, Urgency } from "./types";

export const ASPECT_LABEL: Record<AspectId, string> = {
  performance_reliability: "Performance & Reliability",
  bugs_errors: "Bugs & Errors",
  ui_ux: "UI / UX",
  pricing_billing: "Pricing & Billing",
  account_access: "Account & Access",
  customer_service: "Customer Service",
  delivery_logistics: "Delivery & Logistics",
  ads: "Ads",
  content_catalog: "Content & Catalog",
  connectivity_devices: "Connectivity & Devices",
  features: "Features",
  privacy_security: "Privacy & Security",
  updates: "Updates",
  other: "Other",
};

export const SOURCES: Source[] = ["review", "ticket", "survey"];
export const SENTIMENTS: Sentiment[] = ["negative", "neutral", "positive"];
export const INTENTS: Intent[] = ["complaint", "bug_report", "feature_request", "question", "praise", "churn_risk"];
export const URGENCIES: Urgency[] = ["low", "medium", "high", "critical"];
