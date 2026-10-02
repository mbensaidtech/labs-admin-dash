"use client";

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch, postJson } from "@/lib/api/client";
import { adminKeys } from "@/lib/queryKeys/admin";
import type { HelpRequestDto } from "@/lib/domain/help";
import type { DevDetailDto, EventPage, HelpQueueItemDto, MatrixDto, OverviewDto } from "@/lib/domain/queries";

export const POLL_FAST_MS = 3_000;
export const POLL_SLOW_MS = 5_000;

export function useOverview(initial: OverviewDto): UseQueryResult<OverviewDto> {
  return useQuery({
    queryKey: adminKeys.overview(),
    queryFn: () => apiFetch<OverviewDto>("/api/admin/overview"),
    initialData: initial,
    refetchInterval: POLL_FAST_MS,
    placeholderData: (previous) => previous,
  });
}

export function useMatrix(initial: MatrixDto): UseQueryResult<MatrixDto> {
  return useQuery({
    queryKey: adminKeys.matrix(),
    queryFn: () => apiFetch<MatrixDto>("/api/admin/matrix"),
    initialData: initial,
    refetchInterval: POLL_SLOW_MS,
    placeholderData: (previous) => previous,
  });
}

export function useHelpQueue(statuses: string, initial?: HelpQueueItemDto[]): UseQueryResult<HelpQueueItemDto[]> {
  return useQuery({
    queryKey: adminKeys.help(statuses),
    queryFn: () => apiFetch<HelpQueueItemDto[]>(`/api/admin/help-requests?status=${encodeURIComponent(statuses)}`),
    initialData: initial,
    refetchInterval: POLL_FAST_MS,
    placeholderData: (previous) => previous,
  });
}

export function useDevDetail(id: string, initial: DevDetailDto): UseQueryResult<DevDetailDto> {
  return useQuery({
    queryKey: adminKeys.dev(id),
    queryFn: () => apiFetch<DevDetailDto>(`/api/admin/devs/${encodeURIComponent(id)}`),
    initialData: initial,
    refetchInterval: POLL_SLOW_MS,
    placeholderData: (previous) => previous,
  });
}

export function fetchEventPage(devId: string, cursor: string): Promise<EventPage> {
  return apiFetch<EventPage>(`/api/admin/events?devId=${encodeURIComponent(devId)}&cursor=${encodeURIComponent(cursor)}`);
}

/** Acknowledge / resolve: the mutation throws on failure and every list is invalidated afterwards. */
export function useHelpMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: adminKeys.all });

  const acknowledge = useMutation<HelpRequestDto, Error, { id: string }>({
    mutationFn: ({ id }) => postJson<HelpRequestDto>(`/api/admin/help-requests/${encodeURIComponent(id)}/acknowledge`),
    onSettled: invalidate,
  });

  const resolve = useMutation<HelpRequestDto, Error, { id: string; adminNote?: string }>({
    mutationFn: ({ id, adminNote }) =>
      postJson<HelpRequestDto>(`/api/admin/help-requests/${encodeURIComponent(id)}/resolve`, adminNote ? { adminNote } : {}),
    onSettled: invalidate,
  });

  return { acknowledge, resolve };
}

export function useArchiveMutation(devId: string) {
  const queryClient = useQueryClient();
  return useMutation<{ id: string; archived: boolean }, Error, { archived: boolean }>({
    mutationFn: ({ archived }) => postJson(`/api/admin/devs/${encodeURIComponent(devId)}/${archived ? "archive" : "unarchive"}`),
    onSettled: () => queryClient.invalidateQueries({ queryKey: adminKeys.all }),
  });
}
