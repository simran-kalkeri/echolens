"use client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api, type FeedbackQuery } from "./api";
import { useApp } from "./store";

export function useWorkspaces() {
  return useQuery({ queryKey: ["workspaces"], queryFn: api.workspaces, staleTime: Infinity });
}
export function useOverview() {
  const ws = useApp((s) => s.ws);
  return useQuery({ queryKey: ["overview", ws], queryFn: () => api.overview(ws) });
}
export function useThemes() {
  const ws = useApp((s) => s.ws);
  return useQuery({ queryKey: ["themes", ws], queryFn: () => api.themes(ws) });
}
export function useTheme(id: string | null) {
  const ws = useApp((s) => s.ws);
  return useQuery({ queryKey: ["theme", ws, id], queryFn: () => api.theme(ws, id!), enabled: !!id });
}
export function useGraph() {
  const ws = useApp((s) => s.ws);
  return useQuery({ queryKey: ["graph", ws], queryFn: () => api.graph(ws) });
}
export function useGalaxy() {
  const ws = useApp((s) => s.ws);
  return useQuery({ queryKey: ["galaxy", ws], queryFn: () => api.galaxy(ws) });
}
export function useAlerts() {
  const ws = useApp((s) => s.ws);
  return useQuery({ queryKey: ["alerts", ws], queryFn: () => api.alerts(ws) });
}
export function useInsights() {
  const ws = useApp((s) => s.ws);
  return useQuery({ queryKey: ["insights", ws], queryFn: () => api.insights(ws) });
}
export function useFeedback(q: Omit<FeedbackQuery, "ws">) {
  const ws = useApp((s) => s.ws);
  return useQuery({ queryKey: ["feedback", ws, q], queryFn: () => api.feedback({ ws, ...q }), placeholderData: keepPreviousData });
}
export function usePipeline() {
  return useQuery({ queryKey: ["pipeline"], queryFn: api.pipeline });
}
export function useEval() {
  return useQuery({ queryKey: ["eval"], queryFn: api.eval });
}
