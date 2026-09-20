// src/components/admin/types.ts

export interface SessionPool {
  gc_enabled?: boolean;
  mode?: string;
  ready?: number;
  size?: number;
  throwaway?: boolean;
}

export interface ZaiSession {
  connected?: boolean;
  feVersion?: string;
  userName?: string;
  userId?: string;
  mode?: string;
  features?: Record<string, unknown>;
  sessionPool?: SessionPool;
}

export interface WatchdogInfo {
  running: boolean;
  pid: number | null;
  collectorRunning: boolean;
  lastLine: string | null;
  lastRefill: string | null;
  logTail: string[];
}

export interface AdminStatus {
  process: { running: boolean; pid: number | null };
  health: {
    reachable: boolean;
    healthy: boolean;
    body: Record<string, unknown> | null;
  };
  zai: ZaiSession | null;
  config: { agentMode: boolean };
  token: { mode: "guest" | "token"; masked: string | null; length: number };
  tokenPool: number | null;
  watchdog: WatchdogInfo;
  auth: { mode: "open" | "key"; key: string | null; masked: string | null };
}

export interface ModelInfo {
  id: string;
  display_name?: string;
  description?: string;
  owned_by?: string;
  architecture?: {
    modality?: string;
    input_modalities?: string[];
    output_modalities?: string[];
  };
}

export interface TokenState {
  mode: "guest" | "token";
  masked: string | null;
  length: number;
  agentMode?: boolean;
}
