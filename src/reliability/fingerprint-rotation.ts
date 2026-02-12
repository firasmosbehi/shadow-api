export interface FingerprintProfile {
  id: string;
  userAgent: string;
  acceptLanguage: string;
  platform: string;
  timezone: string;
  viewport: { width: number; height: number };
}

export interface FingerprintSnapshot {
  enabled: boolean;
  total_profiles: number;
  next_index: number;
  profile_usage: Array<{
    id: string;
    uses: number;
    blocked: number;
    last_used_at: string | null;
  }>;
}

interface ProfileState {
  profile: FingerprintProfile;
  uses: number;
  blocked: number;
  lastUsedAt: number | null;
}

const DEFAULT_PROFILES: FingerprintProfile[] = [
  {
    id: "fp_chrome_mac",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    acceptLanguage: "en-US,en;q=0.9",
    platform: "macOS",
    timezone: "America/Los_Angeles",
    viewport: { width: 1512, height: 982 },
  },
  {
    id: "fp_chrome_win",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    acceptLanguage: "en-US,en;q=0.8",
    platform: "Windows",
    timezone: "America/New_York",
    viewport: { width: 1440, height: 900 },
  },
  {
    id: "fp_safari_mac",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    acceptLanguage: "en-US,en;q=0.7",
    platform: "macOS",
    timezone: "America/Chicago",
    viewport: { width: 1680, height: 1050 },
  },
  {
    id: "fp_firefox_linux",
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0",
    acceptLanguage: "en-US,en;q=0.9",
    platform: "Linux",
    timezone: "America/Denver",
    viewport: { width: 1366, height: 768 },
  },
];

export interface FingerprintRotationConfig {
  enabled: boolean;
  profiles?: FingerprintProfile[];
}

export class FingerprintRotator {
  private readonly enabled: boolean;
  private readonly profiles: ProfileState[];
  private cursor = 0;

  public constructor(config: FingerprintRotationConfig) {
    this.enabled = config.enabled;
    const profiles = config.profiles && config.profiles.length > 0 ? config.profiles : DEFAULT_PROFILES;
    this.profiles = profiles.map((profile) => ({
      profile,
      uses: 0,
      blocked: 0,
      lastUsedAt: null,
    }));
  }

  public next(): FingerprintProfile {
    if (!this.enabled || this.profiles.length === 0) {
      return DEFAULT_PROFILES[0];
    }

    const state = this.profiles[this.cursor % this.profiles.length];
    this.cursor = (this.cursor + 1) % this.profiles.length;
    state.uses += 1;
    state.lastUsedAt = Date.now();
    return state.profile;
  }

  public reportBlocked(profileId: string): void {
    const state = this.profiles.find((entry) => entry.profile.id === profileId);
    if (!state) return;
    state.blocked += 1;
  }

  public snapshot(): FingerprintSnapshot {
    return {
      enabled: this.enabled,
      total_profiles: this.profiles.length,
      next_index: this.cursor,
      profile_usage: this.profiles.map((entry) => ({
        id: entry.profile.id,
        uses: entry.uses,
        blocked: entry.blocked,
        last_used_at: entry.lastUsedAt ? new Date(entry.lastUsedAt).toISOString() : null,
      })),
    };
  }
}
