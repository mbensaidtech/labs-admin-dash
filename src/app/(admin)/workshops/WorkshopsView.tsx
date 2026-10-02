"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useWorkshopMutations, useWorkshops } from "@/lib/api/hooks";
import { useI18n } from "@/lib/i18n/provider";
import { absoluteTime } from "@/lib/i18n/time";
import { formatWorkshopCode } from "@/lib/domain/workshopFormat";
import type { WorkshopDto } from "@/lib/domain/workshops";
import { DisconnectedBanner } from "@/components/DisconnectedBanner";
import { Page } from "@/components/Page";

type Dialog =
  | { kind: "create" }
  | { kind: "created"; workshop: WorkshopDto }
  | { kind: "rename"; workshop: WorkshopDto }
  | { kind: "rotate"; workshop: WorkshopDto }
  | { kind: "delete"; workshop: WorkshopDto };

const NAME_MIN = 2;
const NAME_MAX = 80;

function validName(value: string): boolean {
  const length = value.trim().length;
  return length >= NAME_MIN && length <= NAME_MAX;
}

export function WorkshopsView({ initial }: { initial: WorkshopDto[] }) {
  const { t } = useI18n();
  const query = useWorkshops(initial);
  const workshops = query.data ?? initial;
  const [dialog, setDialog] = useState<Dialog | null>(null);

  return (
    <Page
      title={t("workshops.title")}
      actions={
        <button type="button" onClick={() => setDialog({ kind: "create" })} className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">
          + {t("workshops.new")}
        </button>
      }
    >
      <DisconnectedBanner isError={query.isError} />
      {workshops.length === 0 ? (
        <p className="rounded-lg border border-border bg-panel p-6 text-center text-muted">{t("workshops.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {workshops.map((workshop) => (
            <WorkshopRow key={workshop.id} workshop={workshop} onAction={setDialog} />
          ))}
        </ul>
      )}
      <WorkshopDialog dialog={dialog} setDialog={setDialog} />
    </Page>
  );
}

function WorkshopRow({ workshop, onAction }: { workshop: WorkshopDto; onAction: (dialog: Dialog) => void }) {
  const { t, locale } = useI18n();
  const { update } = useWorkshopMutations();
  const [error, setError] = useState<string | null>(null);
  const closed = workshop.status === "closed";
  const button = "rounded border border-border px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-text disabled:opacity-50";

  const toggleStatus = () => {
    setError(null);
    update.mutate(
      { id: workshop.id, status: closed ? "active" : "closed" },
      { onError: (err) => setError(t("common.error", { message: err.message })) },
    );
  };

  return (
    <li className={`rounded-lg border bg-panel p-4 ${closed ? "border-border opacity-75" : "border-border"}`}>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_auto_auto] md:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate font-semibold">{workshop.name}</h2>
            <span
              className={`rounded-full border px-2 py-0.5 text-xs font-medium ${closed ? "border-border bg-panel-2 text-muted" : "border-green/50 bg-green/20 text-green"}`}
            >
              {closed ? t("workshops.closedStatus") : t("workshops.active")}
            </span>
            {workshop.legacy ? <span className="text-xs text-muted">{t("workshops.legacy")}</span> : null}
          </div>
          <div className="mt-1 text-xs text-muted">
            {t("workshops.created")} {absoluteTime(workshop.createdAt, locale)}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <code className="select-all rounded bg-panel-2 px-2 py-1 font-mono text-base tracking-wider" aria-label={t("workshops.code")}>
            {formatWorkshopCode(workshop.code)}
          </code>
          <CopyButton text={formatWorkshopCode(workshop.code)} label={t("workshops.copy")} />
          <CopyButton text={() => instructionsText(t, workshop)} label={t("workshops.copyInstructions")} />
        </div>

        <div className="text-sm">
          <span className="text-muted">{t("workshops.devs")}: </span>
          {t("workshops.devsCount", { active: workshop.devs.active, total: workshop.devs.total })}
        </div>

        <div className="flex flex-wrap gap-1.5 md:justify-end">
          <button type="button" className={button} onClick={() => onAction({ kind: "rename", workshop })}>
            {t("workshops.rename")}
          </button>
          <button type="button" className={button} onClick={() => onAction({ kind: "rotate", workshop })}>
            {t("workshops.rotate")}
          </button>
          <button type="button" className={button} disabled={update.isPending} onClick={toggleStatus}>
            {closed ? t("workshops.reopen") : t("workshops.close")}
          </button>
          <button
            type="button"
            className={`${button} hover:border-red hover:text-red`}
            disabled={workshop.devs.total > 0}
            title={workshop.devs.total > 0 ? t("workshops.deleteDisabled", { count: workshop.devs.total }) : undefined}
            onClick={() => onAction({ kind: "delete", workshop })}
          >
            {t("workshops.delete")}
          </button>
        </div>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-red">
          {error}
        </p>
      ) : null}
    </li>
  );
}

/** The text a trainer pastes in the chat or on a slide: server URL (this admin's origin) and the code. Built on click. */
function instructionsText(t: ReturnType<typeof useI18n>["t"], workshop: WorkshopDto): string {
  return t("workshops.instructions", { name: workshop.name, url: window.location.origin, code: formatWorkshopCode(workshop.code) });
}

function CopyButton({ text, label, primary }: { text: string | (() => string); label: string; primary?: boolean }) {
  const { t } = useI18n();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(typeof text === "function" ? text() : text);
      setState("copied");
    } catch {
      setState("failed");
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2_000);
  };

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={copy}
        className={
          primary
            ? "rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
            : "rounded border border-border px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-text"
        }
      >
        {state === "copied" ? `✓ ${t("workshops.copied")}` : label}
      </button>
      <span aria-live="polite" className="sr-only">
        {state === "copied" ? t("workshops.copied") : ""}
      </span>
      {state === "failed" ? (
        <span role="alert" className="text-xs text-red">
          {t("workshops.copyFailed")}
        </span>
      ) : null}
    </span>
  );
}

function WorkshopDialog({ dialog, setDialog }: { dialog: Dialog | null; setDialog: (dialog: Dialog | null) => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (dialog && !element.open) element.showModal();
    if (!dialog && element.open) element.close();
  }, [dialog]);

  return (
    <dialog ref={ref} onClose={() => setDialog(null)} className="m-auto w-[calc(100%-2rem)] max-w-md rounded-lg border border-border bg-panel p-0 text-text backdrop:bg-black/60">
      {dialog ? <DialogBody key={`${dialog.kind}-${"workshop" in dialog ? dialog.workshop.id : ""}`} dialog={dialog} setDialog={setDialog} /> : null}
    </dialog>
  );
}

function DialogBody({ dialog, setDialog }: { dialog: Dialog; setDialog: (dialog: Dialog | null) => void }) {
  const { t } = useI18n();
  const { create, update, rotate, remove } = useWorkshopMutations();
  const [name, setName] = useState(dialog.kind === "rename" ? dialog.workshop.name : "");
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => setDialog(null);
  const fail = (err: Error) => setError(t("common.error", { message: err.message }));
  const cancelButton = (
    <button type="button" onClick={close} className="rounded border border-border px-3 py-1.5 text-sm text-muted hover:text-text">
      {t("workshops.cancel")}
    </button>
  );

  if (dialog.kind === "created") {
    const { workshop } = dialog;
    return (
      <div className="flex flex-col gap-4 p-5">
        <h2 className="text-lg font-semibold">{t("workshops.createdTitle", { name: workshop.name })}</h2>
        <p className="text-sm text-muted">{t("workshops.createdBody")}</p>
        <code className="select-all rounded bg-panel-2 px-3 py-3 text-center font-mono text-3xl tracking-widest">{formatWorkshopCode(workshop.code)}</code>
        <div className="flex flex-wrap gap-2">
          <CopyButton text={formatWorkshopCode(workshop.code)} label={t("workshops.copy")} primary />
          <CopyButton text={() => instructionsText(t, workshop)} label={t("workshops.copyInstructions")} />
        </div>
        <div className="flex justify-end">
          <button type="button" onClick={close} className="rounded border border-border px-3 py-1.5 text-sm hover:border-accent">
            {t("workshops.done")}
          </button>
        </div>
      </div>
    );
  }

  if (dialog.kind === "create" || dialog.kind === "rename") {
    const invalid = !validName(name);
    const pending = create.isPending || update.isPending;
    const submit = (event: FormEvent) => {
      event.preventDefault();
      setTouched(true);
      setError(null);
      if (invalid) return;
      if (dialog.kind === "create") {
        create.mutate({ name: name.trim() }, { onSuccess: (workshop) => setDialog({ kind: "created", workshop }), onError: fail });
      } else {
        update.mutate({ id: dialog.workshop.id, name: name.trim() }, { onSuccess: close, onError: fail });
      }
    };
    return (
      <form onSubmit={submit} noValidate className="flex flex-col gap-3 p-5">
        <h2 className="text-lg font-semibold">{dialog.kind === "create" ? t("workshops.createTitle") : t("workshops.renameTitle")}</h2>
        <label className="flex flex-col gap-1 text-sm text-muted">
          {t("workshops.name")}
          <input
            autoFocus
            value={name}
            maxLength={NAME_MAX}
            placeholder={t("workshops.namePlaceholder")}
            aria-invalid={touched && invalid}
            aria-describedby="workshop-name-error"
            onChange={(event) => setName(event.target.value)}
            className="rounded border border-border bg-bg px-2 py-1.5 text-text"
          />
        </label>
        {touched && invalid ? (
          <p id="workshop-name-error" role="alert" className="text-xs text-red">
            {t("workshops.nameError")}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-xs text-red">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          {cancelButton}
          <button type="submit" disabled={pending} className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            {dialog.kind === "create" ? t("workshops.create") : t("workshops.save")}
          </button>
        </div>
      </form>
    );
  }

  const isRotate = dialog.kind === "rotate";
  const mutation = isRotate ? rotate : remove;
  return (
    <div className="flex flex-col gap-3 p-5">
      <h2 className="text-lg font-semibold">
        {isRotate ? t("workshops.rotateTitle", { name: dialog.workshop.name }) : t("workshops.deleteTitle", { name: dialog.workshop.name })}
      </h2>
      <p className="text-sm text-muted">{isRotate ? t("workshops.rotateBody") : t("workshops.deleteBody")}</p>
      {error ? (
        <p role="alert" className="text-xs text-red">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        {cancelButton}
        <button
          type="button"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate({ id: dialog.workshop.id }, { onSuccess: close, onError: fail })}
          className={`rounded px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${isRotate ? "bg-accent" : "bg-red"}`}
        >
          {isRotate ? t("workshops.rotateConfirm") : t("workshops.deleteConfirm")}
        </button>
      </div>
    </div>
  );
}
