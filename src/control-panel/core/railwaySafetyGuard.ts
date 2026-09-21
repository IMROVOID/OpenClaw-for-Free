export interface SafetyStatus {
  restricted: boolean;
  reason?: string;
  cooldownUntil?: number;
}

export class RailwaySafetyGuard {
  private static statusMap: Map<string, SafetyStatus> = new Map();
  private static lastRequestTime = 0;
  private static MIN_REQUEST_INTERVAL_MS = 300;

  /**
   * Throttles requests to prevent tripping Railway rate limits or abuse heuristics.
   */
  static async throttle(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.MIN_REQUEST_INTERVAL_MS) {
      await new Promise((resolve) => setTimeout(resolve, this.MIN_REQUEST_INTERVAL_MS - elapsed));
    }
    this.lastRequestTime = Date.now();
  }

  /**
   * Checks if an API token is currently blocked by a circuit breaker.
   */
  static isRestricted(apiKey: string): { restricted: boolean; reason?: string } {
    const key = (apiKey || '').trim();
    if (!key) return { restricted: false };
    const status = this.statusMap.get(key);
    if (!status) return { restricted: false };

    if (status.cooldownUntil && Date.now() < status.cooldownUntil) {
      return { restricted: true, reason: status.reason };
    }

    // Cooldown expired, clear restriction
    this.statusMap.delete(key);
    return { restricted: false };
  }

  /**
   * Checks if an error message indicates an account restriction, payment block, or rate limit.
   */
  static isAbuseOrRestrictionError(errorMsg?: string): boolean {
    if (!errorMsg) return false;
    const lower = errorMsg.toLowerCase();
    return (
      lower.includes('payment method required') ||
      lower.includes('payment-method restriction') ||
      lower.includes('workspace cannot create new resources') ||
      lower.includes('rate limit') ||
      lower.includes('too many requests') ||
      lower.includes('risk level') ||
      lower.includes('fair use') ||
      lower.includes('banned') ||
      lower.includes('suspended')
    );
  }

  /**
   * Trips the circuit breaker when an abuse or restriction signal is detected.
   * Prevents repeated retries from getting the account flagged or banned.
   */
  static recordError(apiKey: string, errorMsg: string, cooldownMinutes = 5): void {
    const key = (apiKey || '').trim();
    if (!key) return;

    if (this.isAbuseOrRestrictionError(errorMsg)) {
      this.statusMap.set(key, {
        restricted: true,
        reason: errorMsg,
        cooldownUntil: Date.now() + cooldownMinutes * 60 * 1000
      });
    }
  }

  /**
   * Clears any circuit breaker restriction upon successful operation.
   */
  static recordSuccess(apiKey: string): void {
    const key = (apiKey || '').trim();
    if (key) {
      this.statusMap.delete(key);
    }
  }

  /**
   * Clears all safety state (useful for testing).
   */
  static reset(): void {
    this.statusMap.clear();
    this.lastRequestTime = 0;
  }
}
