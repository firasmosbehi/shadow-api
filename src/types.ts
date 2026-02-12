export interface ActorInput {
  host?: string;
  port?: number;
  logLevel?: "DEBUG" | "INFO" | "WARNING" | "ERROR";
}

export interface RuntimeConfig {
  host: string;
  port: number;
  logLevel: "DEBUG" | "INFO" | "WARNING" | "ERROR";
}
