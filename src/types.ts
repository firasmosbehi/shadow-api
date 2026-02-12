export interface ActorInput {
  host?: string;
  port?: number;
  logLevel?: "DEBUG" | "INFO" | "WARNING" | "ERROR";
  requiredEnvVars?: string[];
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
}

export interface RuntimeConfig {
  host: string;
  port: number;
  logLevel: "DEBUG" | "INFO" | "WARNING" | "ERROR";
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
}
