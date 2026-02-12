export interface ActorInput {
  host?: string;
  port?: number;
  logLevel?: "DEBUG" | "INFO" | "WARNING" | "ERROR";
  requiredEnvVars?: string[];
}

export interface RuntimeConfig {
  host: string;
  port: number;
  logLevel: "DEBUG" | "INFO" | "WARNING" | "ERROR";
}
