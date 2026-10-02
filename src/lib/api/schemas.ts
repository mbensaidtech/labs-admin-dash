import { z } from "zod";
import { FAILURE_STAGES, PROGRESS_STATES, RUN_STATUSES, RUN_TARGETS } from "@/lib/db/types";

export const USERNAME_PATTERN = /^[A-Za-z0-9._-]{2,32}$/;
// `heartbeat` has a single segment, so the dotted suffix is optional (the spec lists both forms).
export const EVENT_TYPE_PATTERN = /^[a-z]+(\.[a-z]+)*$/;
export const LAB_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const MAX_EVENT_PAYLOAD_BYTES = 32 * 1024;
export const MAX_BATCH_BYTES = 256 * 1024;
export const MAX_BATCH_EVENTS = 100;
export const MAX_BODY_BYTES = 16 * 1024;

export const userIdSchema = z.string().regex(UUID_PATTERN, "userId must be a UUID");
export const usernameSchema = z
  .string()
  .regex(USERNAME_PATTERN, "username must be 2-32 characters among letters, digits, '.', '_' and '-'");
export const labIdSchema = z.string().regex(LAB_ID_PATTERN, "labId is invalid");

/** userId + username, present in every public request body (Business Rule 2). */
export const identitySchema = z.object({
  userId: userIdSchema,
  username: usernameSchema,
});

export const registerSchema = identitySchema.extend({
  dashboardVersion: z.string().max(64).optional(),
  platform: z.string().max(64).optional(),
});

const isoDate = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), "occurredAt must be an ISO 8601 date");

export const eventSchema = z.object({
  eventId: z.string().min(8).max(128),
  type: z.string().regex(EVENT_TYPE_PATTERN, "type must be lower-case segments separated by dots (e.g. run.started)"),
  occurredAt: isoDate,
  labId: labIdSchema.optional(),
  payload: z.unknown().optional(),
});

export const eventBatchSchema = identitySchema.extend({
  events: z.array(eventSchema).min(1).max(MAX_BATCH_EVENTS),
});

export type EventInput = z.infer<typeof eventSchema>;
export type EventBatchInput = z.infer<typeof eventBatchSchema>;

export const helpRequestSchema = identitySchema.extend({
  labId: labIdSchema.optional(),
  message: z.string().max(500).optional(),
});

export const resolveSchema = z.object({
  adminNote: z.string().max(500).optional(),
});

export const loginSchema = z.object({
  password: z.string().min(1).max(256),
});

// Payloads of the known event types. Unknown types are stored verbatim, so these are only applied
// to the types the projection understands; a known type with a bad payload rejects the batch.
const nonNegativeInt = z.number().int().min(0);
const optionalDate = isoDate.nullable().optional();

export const catalogSyncedPayload = z.object({
  labs: z
    .array(
      z.object({
        id: labIdSchema,
        number: z.string().max(16).default(""),
        track: z.string().max(64).default(""),
        title: z.string().max(200).default(""),
        level: z.string().max(32).default(""),
        interactive: z.boolean().default(false),
        sortOrder: z.number().int().default(999),
      }),
    )
    .max(200),
});

export const progressSnapshotPayload = z.object({
  labs: z
    .array(
      z.object({
        labId: labIdSchema,
        state: z.enum(PROGRESS_STATES),
        runCount: nonNegativeInt.default(0),
        solutionRunCount: nonNegativeInt.default(0),
        lastRunAt: optionalDate,
        lastRunStatus: z.enum(RUN_STATUSES).nullable().optional(),
        lastRunTarget: z.enum(RUN_TARGETS).nullable().optional(),
        completedAt: optionalDate,
        firstRunAt: optionalDate,
        totalTokens: nonNegativeInt.default(0),
        activeRunId: z.string().max(128).nullable().optional(),
        solutionViewedAt: optionalDate,
      }),
    )
    .max(200),
});

export const runStartedPayload = z.object({
  runId: z.string().min(1).max(128),
  target: z.enum(RUN_TARGETS),
});

export const runFinishedPayload = z.object({
  runId: z.string().min(1).max(128),
  target: z.enum(RUN_TARGETS),
  status: z.enum(RUN_STATUSES),
  failureStage: z.enum(FAILURE_STAGES).nullable().optional(),
  summary: z.string().max(1000).nullable().optional(),
  durationMs: nonNegativeInt.nullable().optional(),
  buildDurationMs: nonNegativeInt.nullable().optional(),
  runDurationMs: nonNegativeInt.nullable().optional(),
  exitCode: z.number().int().nullable().optional(),
  checks: z.array(z.object({ id: z.string().max(64), passed: z.boolean() })).max(100).nullable().optional(),
  totalTokens: nonNegativeInt.nullable().optional(),
});

export const heartbeatPayload = z.object({
  browserConnected: z.boolean().optional(),
  activeRunId: z.string().max(128).nullable().optional(),
});

export const settingsChangedPayload = z.object({
  authMode: z.enum(["apiKey", "entraId", "notConfigured"]).optional(),
});

/** Workshops (admin): a trimmed name of 2–80 characters; the status can be switched between active and closed. */
export const workshopNameSchema = z.string().trim().min(2, "name must be 2-80 characters").max(80, "name must be 2-80 characters");
export const createWorkshopSchema = z.object({ name: workshopNameSchema });
export const updateWorkshopSchema = z
  .object({ name: workshopNameSchema.optional(), status: z.enum(["active", "closed"]).optional() })
  .refine((value) => value.name !== undefined || value.status !== undefined, { message: "name or status is required", path: ["name"] });
