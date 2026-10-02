"use client";

import { useRef, useState } from "react";
import { ApiClientError } from "@/lib/api/client";
import { useHelpMutations } from "@/lib/api/hooks";
import { useI18n } from "@/lib/i18n/provider";
import type { HelpStatus } from "@/lib/db/types";

/** Acknowledge / Resolve buttons with the note dialog; errors (409 already closed) are shown inline. */
export function HelpActions({ id, status, compact }: { id: string; status: HelpStatus; compact?: boolean }) {
  const { t } = useI18n();
  const { acknowledge, resolve } = useHelpMutations();
  const dialog = useRef<HTMLDialogElement>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onError = (err: unknown) => {
    setError(err instanceof ApiClientError && err.status === 409 ? t("help.alreadyClosed") : t("common.error", { message: (err as Error).message }));
  };

  const pending = acknowledge.isPending || resolve.isPending;
  const size = compact ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "open" ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => acknowledge.mutate({ id }, { onError })}
          className={`rounded border border-amber/60 bg-amber/10 font-medium text-amber hover:bg-amber/20 disabled:opacity-50 ${size}`}
        >
          {t("help.acknowledge")}
        </button>
      ) : null}
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          dialog.current?.showModal();
        }}
        className={`rounded border border-green/60 bg-green/10 font-medium text-green hover:bg-green/20 disabled:opacity-50 ${size}`}
      >
        {t("help.resolve")}
      </button>
      {error ? <span role="alert" className="text-xs text-red">{error}</span> : null}

      <dialog ref={dialog} className="m-auto w-[calc(100%-2rem)] max-w-md rounded-lg border border-border bg-panel p-0 text-text backdrop:bg-black/60" onClose={() => setNote("")}>
        <form
          method="dialog"
          className="flex flex-col gap-3 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            resolve.mutate(
              { id, adminNote: note.trim() || undefined },
              {
                onSuccess: () => dialog.current?.close(),
                onError: (err) => {
                  dialog.current?.close();
                  onError(err);
                },
              },
            );
          }}
        >
          <h2 className="text-lg font-semibold">{t("help.resolveTitle")}</h2>
          <label className="flex flex-col gap-1 text-sm text-muted">
            {t("help.note")}
            <textarea
              value={note}
              maxLength={500}
              rows={3}
              onChange={(event) => setNote(event.target.value)}
              className="rounded border border-border bg-bg px-2 py-1 text-text"
            />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => dialog.current?.close()} className="rounded border border-border px-3 py-1.5 text-sm text-muted hover:text-text">
              {t("help.cancel")}
            </button>
            <button type="submit" disabled={resolve.isPending} className="rounded bg-green px-3 py-1.5 text-sm font-medium text-black disabled:opacity-50">
              {t("help.confirm")}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
