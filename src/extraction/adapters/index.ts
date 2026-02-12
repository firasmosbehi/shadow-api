import type { SourceAdapter } from "../types";
import { DiscordServerMetadataAdapter } from "./discord";
import { LinkedInProfileAdapter } from "./linkedin";
import { XProfileAdapter } from "./x";

export const createDefaultAdapters = (): SourceAdapter[] => [
  new LinkedInProfileAdapter(),
  new XProfileAdapter(),
  new DiscordServerMetadataAdapter(),
];
