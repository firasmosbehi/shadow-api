export interface ActorInput {
  host?: string;
  port?: number;
  logLevel?: "DEBUG" | "INFO" | "WARNING" | "ERROR";
  requiredEnvVars?: string[];
  apiKeyEnabled?: boolean;
  apiKey?: string;
  browserPoolEnabled?: boolean;
  browserPoolSize?: number;
  browserHeadless?: boolean;
  browserLaunchTimeoutMs?: number;
  standbyEnabled?: boolean;
  standbyIdleTimeoutMs?: number;
  standbyTickIntervalMs?: number;
  standbyRecycleAfterMs?: number;
  sessionStorageEnabled?: boolean;
  sessionStoreName?: string;
  sessionStoreKeyPrefix?: string;
  requestQueueConcurrency?: number;
  requestQueueMaxSize?: number;
  requestQueueTaskTimeoutMs?: number;
  fetchTimeoutDefaultMs?: number;
  fetchTimeoutMinMs?: number;
  fetchTimeoutMaxMs?: number;
  requestBodyMaxBytes?: number;
  shutdownDrainTimeoutMs?: number;
  mockFetchDelayMs?: number;
}

export interface RuntimeConfig {
  host: string;
  port: number;
  logLevel: "DEBUG" | "INFO" | "WARNING" | "ERROR";
  apiKeyEnabled: boolean;
  apiKey: string | null;
  browserPoolEnabled: boolean;
  browserPoolSize: number;
  browserHeadless: boolean;
  browserLaunchTimeoutMs: number;
  standbyEnabled: boolean;
  standbyIdleTimeoutMs: number;
  standbyTickIntervalMs: number;
  standbyRecycleAfterMs: number;
  sessionStorageEnabled: boolean;
  sessionStoreName: string;
  sessionStoreKeyPrefix: string;
  requestQueueConcurrency: number;
  requestQueueMaxSize: number;
  requestQueueTaskTimeoutMs: number;
  fetchTimeoutDefaultMs: number;
  fetchTimeoutMinMs: number;
  fetchTimeoutMaxMs: number;
  requestBodyMaxBytes: number;
  shutdownDrainTimeoutMs: number;
  mockFetchDelayMs: number;
}
