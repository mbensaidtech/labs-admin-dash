"use client";

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch, postJson } from "@/lib/api/client";
import { adminKeys } from "@/lib/queryKeys/admin";
import { scopeQuery } from "@/lib/admin/WorkshopScopeProvider";
import type { HelpRequestDto } from "@/lib/domain/help";
import type { DevDetailDto, EventPage, HelpQueueItemDto, MatrixDto, OverviewDto, WorkshopScope } from "@/lib/domain/queries";
import type { WorkshopDto } from "@/lib/domain/workshops";

export const POLL_FAST_MS = 3_000;
export const POLL_SLOW_MS = 5_000;

// Server-rendered data seeds the cache only for the scope it was computed for; another scope fetches.
export function useOverview(initial: OverviewDto, scope: WorkshopScope): UseQueryResult<OverviewDto> {
  return useQuery({
    queryKey: adminKeys.overview(scope),
    queryFn: () => apiFetch<OverviewDto>(`/api/admin/overview${scopeQuery(scope)}`),
    initialData: initial.scope === scope ? initial : undefined,
    refetchInterval: POLL_FAST_MS,
    placeholderData: (previous) => previous,
  });
}

export function useMatrix(initial: MatrixDto, scope: WorkshopScope): UseQueryResult<MatrixDto> {
  return useQuery({
    queryKey: adminKeys.matrix(scope),
    queryFn: () => apiFetch<MatrixDto>(`/api/admin/matrix${scopeQuery(scope)}`),
    initialData: initial.scope === scope ? initial : undefined,
    refetchInterval: POLL_SLOW_MS,
    placeholderData: (previous) => previous,
  });
}

export function useHelpQueue(
  statuses: string,
  scope: WorkshopScope,
  initial?: { scope: WorkshopScope; items: HelpQueueItemDto[] },
): UseQueryResult<HelpQueueItemDto[]> {
  return useQuery({
    queryKey: adminKeys.help(statuses, scope),
    queryFn: () => apiFetch<HelpQueueItemDto[]>(`/api/admin/help-requests?status=${encodeURIComponent(statuses)}${scopeQuery(scope, "&")}`),
    initialData: initial && initial.scope === scope ? initial.items : undefined,
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

export function useWorkshops(initial?: WorkshopDto[]): UseQueryResult<WorkshopDto[]> {
  return useQuery({
    queryKey: adminKeys.workshops(),
    queryFn: () => apiFetch<WorkshopDto[]>("/api/admin/workshops"),
    initialData: initial,
  });
}

function sendJson<T>(method: "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
}

/** Create / delete refetch every list (counts and scopes change); rename, close and rotate patch the cached list. */
export function useWorkshopMutations() {
  const queryClient = useQueryClient();
  const patchList = (updated: WorkshopDto) =>
    queryClient.setQueryData<WorkshopDto[]>(adminKeys.workshops(), (list) => list?.map((item) => (item.id === updated.id ? updated : item)));
  const invalidateAll = () => queryClient.invalidateQueries({ queryKey: adminKeys.all });

  const create = useMutation<WorkshopDto, Error, { name: string }>({
    mutationFn: (body) => postJson<WorkshopDto>("/api/admin/workshops", body),
    onSuccess: invalidateAll,
  });

  const update = useMutation<WorkshopDto, Error, { id: string; name?: string; status?: WorkshopDto["status"] }>({
    mutationFn: ({ id, ...body }) => sendJson<WorkshopDto>("PATCH", `/api/admin/workshops/${encodeURIComponent(id)}`, body),
    onSuccess: (updated) => {
      patchList(updated);
      // Names also label developers on the other pages: refresh those, not the list just patched.
      void queryClient.invalidateQueries({ queryKey: adminKeys.all, predicate: (query) => query.queryKey[1] !== "workshops" });
    },
  });

  const rotate = useMutation<WorkshopDto, Error, { id: string }>({
    mutationFn: ({ id }) => postJson<WorkshopDto>(`/api/admin/workshops/${encodeURIComponent(id)}/rotate-code`),
    onSuccess: patchList,
  });

  const remove = useMutation<void, Error, { id: string }>({
    mutationFn: ({ id }) => sendJson<void>("DELETE", `/api/admin/workshops/${encodeURIComponent(id)}`),
    onSuccess: invalidateAll,
  });

  return { create, update, rotate, remove };
}
