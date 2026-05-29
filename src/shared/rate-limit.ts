export type RateLimitDecision = {
  allowed: boolean;
  retryAfterMs: number;
  remaining: number;
};

type RateLimitState = {
  windowStartedAtMs: number;
  count: number;
  blockedUntilMs: number;
  lastSeenAtMs: number;
};

export class FixedWindowRateLimiter {
  private readonly states = new Map<string, RateLimitState>();
  private consumeCounter = 0;

  constructor(
    private readonly config: {
      windowMs: number;
      maxInWindow: number;
      blockDurationMs: number;
      stateTtlMs: number;
    }
  ) {}

  consume(key: string, nowMs = Date.now()): RateLimitDecision {
    const state = this.getOrCreateState(key, nowMs);
    state.lastSeenAtMs = nowMs;

    if (state.blockedUntilMs > nowMs) {
      return {
        allowed: false,
        retryAfterMs: state.blockedUntilMs - nowMs,
        remaining: 0
      };
    }

    if (nowMs - state.windowStartedAtMs >= this.config.windowMs) {
      state.windowStartedAtMs = nowMs;
      state.count = 0;
    }

    state.count += 1;
    const remaining = Math.max(0, this.config.maxInWindow - state.count);

    if (state.count > this.config.maxInWindow) {
      state.blockedUntilMs = nowMs + this.config.blockDurationMs;
      state.count = this.config.maxInWindow;
      return {
        allowed: false,
        retryAfterMs: this.config.blockDurationMs,
        remaining: 0
      };
    }

    this.consumeCounter += 1;
    if (this.consumeCounter % 200 === 0) {
      this.cleanup(nowMs);
    }

    return {
      allowed: true,
      retryAfterMs: 0,
      remaining
    };
  }

  private getOrCreateState(key: string, nowMs: number): RateLimitState {
    const existing = this.states.get(key);
    if (existing) {
      return existing;
    }

    const created: RateLimitState = {
      windowStartedAtMs: nowMs,
      count: 0,
      blockedUntilMs: 0,
      lastSeenAtMs: nowMs
    };
    this.states.set(key, created);
    return created;
  }

  private cleanup(nowMs: number) {
    for (const [key, state] of this.states) {
      if (nowMs - state.lastSeenAtMs > this.config.stateTtlMs) {
        this.states.delete(key);
      }
    }
  }
}
