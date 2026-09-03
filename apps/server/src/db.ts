import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Session, Turn } from "@knot/shared";
import { config } from "./config.js";

mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  round INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id, seq);
CREATE TABLE IF NOT EXISTS reports (
  session_id TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  generated_at INTEGER NOT NULL
);
`);

// ─── sessions ────────────────────────────────────────────────────────────────

export function saveSession(s: Session): void {
  db.prepare(
    `INSERT INTO sessions (id, json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`
  ).run(s.id, JSON.stringify(s), Date.now());
}

export function getSession(id: string): Session | undefined {
  const row = db.prepare(`SELECT json FROM sessions WHERE id = ?`).get(id) as
    | { json: string }
    | undefined;
  return row ? (JSON.parse(row.json) as Session) : undefined;
}

// ─── turns (append-only transcript = grounding source of truth) ───────────────

let seqCounter = new Map<string, number>();

export function appendTurn(sessionId: string, turn: Turn): void {
  const seq = (seqCounter.get(sessionId) ?? loadMaxSeq(sessionId)) + 1;
  seqCounter.set(sessionId, seq);
  db.prepare(
    `INSERT INTO turns (id, session_id, round, seq, json) VALUES (?, ?, ?, ?, ?)`
  ).run(turn.id, sessionId, turn.round, seq, JSON.stringify(turn));
}

function loadMaxSeq(sessionId: string): number {
  const row = db
    .prepare(`SELECT MAX(seq) as m FROM turns WHERE session_id = ?`)
    .get(sessionId) as { m: number | null };
  return row.m ?? 0;
}

export function getTurns(sessionId: string, round?: number): Turn[] {
  const rows = (
    round === undefined
      ? db
          .prepare(`SELECT json FROM turns WHERE session_id = ? ORDER BY seq`)
          .all(sessionId)
      : db
          .prepare(
            `SELECT json FROM turns WHERE session_id = ? AND round = ? ORDER BY seq`
          )
          .all(sessionId, round)
  ) as { json: string }[];
  return rows.map((r) => JSON.parse(r.json) as Turn);
}

// ─── reports ─────────────────────────────────────────────────────────────────

export function saveReport(sessionId: string, report: unknown): void {
  db.prepare(
    `INSERT INTO reports (session_id, json, generated_at) VALUES (?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET json = excluded.json, generated_at = excluded.generated_at`
  ).run(sessionId, JSON.stringify(report), Date.now());
}

export function getReport<T = unknown>(sessionId: string): T | undefined {
  const row = db
    .prepare(`SELECT json FROM reports WHERE session_id = ?`)
    .get(sessionId) as { json: string } | undefined;
  return row ? (JSON.parse(row.json) as T) : undefined;
}
