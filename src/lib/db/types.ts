export type ProgressState = "notStarted" | "inProgress" | "completed";
export type RunTarget = "start" | "solution";
export type RunStatus = "running" | "passed" | "failed" | "cancelled" | "timedOut";
export type FailureStage = "build" | "run" | "checks" | "input" | "dashboard";
export type HelpStatus = "open" | "acknowledged" | "resolved" | "cancelled";
export type HelpClosedBy = "admin" | "dev";

export const PROGRESS_STATES: readonly ProgressState[] = ["notStarted", "inProgress", "completed"];
export const RUN_TARGETS: readonly RunTarget[] = ["start", "solution"];
export const RUN_STATUSES: readonly RunStatus[] = ["running", "passed", "failed", "cancelled", "timedOut"];
export const FAILURE_STAGES: readonly FailureStage[] = ["build", "run", "checks", "input", "dashboard"];
export const HELP_STATUSES: readonly HelpStatus[] = ["open", "acknowledged", "resolved", "cancelled"];
export const ACTIVE_HELP_STATUSES: readonly HelpStatus[] = ["open", "acknowledged"];

export interface LabProgress {
  state: ProgressState;
  activeRunId?: string | null;
  runCount: number;
  solutionRunCount: number;
  firstRunAt?: Date;
  lastRunAt?: Date;
  lastRunStatus?: RunStatus;
  lastRunTarget?: RunTarget;
  completedAt?: Date;
  solutionViewedAt?: Date;
  totalTokens: number;
  updatedAt: Date;
}

export interface DevDoc {
  _id: string;
  username: string;
  tokenHash: string;
  dashboardVersion?: string;
  platform?: string;
  createdAt: Date;
  lastSeenAt: Date;
  lastActivityAt: Date;
  lastActivityType?: string;
  lastActivityLab?: string;
  archivedAt?: Date | null;
  catalogLabIds: string[];
  progress: Record<string, LabProgress>;
}

export interface LabDoc {
  _id: string;
  number: string;
  track: string;
  title: string;
  level: string;
  interactive: boolean;
  sortOrder: number;
  firstSeenAt: Date;
  updatedAt: Date;
}

export interface RunDoc {
  _id: string;
  devId: string;
  labId: string;
  target: RunTarget;
  status: RunStatus;
  failureStage?: FailureStage;
  summary?: string;
  startedAt: Date;
  finishedAt?: Date;
  durationMs?: number;
  checksPassed?: number;
  checksTotal?: number;
  totalTokens?: number;
}

export interface HelpRequestDoc {
  _id: string;
  devId: string;
  labId?: string;
  message?: string;
  status: HelpStatus;
  createdAt: Date;
  acknowledgedAt?: Date;
  closedAt?: Date;
  closedBy?: HelpClosedBy;
  adminNote?: string;
}

export interface EventDoc {
  _id: string;
  devId: string;
  type: string;
  labId?: string;
  occurredAt: Date;
  receivedAt: Date;
  payload: unknown;
}
