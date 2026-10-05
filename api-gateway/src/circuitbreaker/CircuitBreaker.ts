export enum CircuitBreakerState {
    CLOSED = "CLOSED",
    OPEN = "OPEN",
    HALF_OPEN = "HALF_OPEN"
}

export interface CircuitBreakerConfig {
    failureThreshold: number;
    resetTimeout: number;
    halfOpenMaxRequests: number;
}

export class CircuitBreaker {
    private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
    private failureCount: number = 0;
    private lastFailureTime: number = 0;
    private halfOpenRequests: number = 0;

    constructor(private config: CircuitBreakerConfig) {}

    /**
     * Checks if a request can be executed.
     * Evaluates timeouts to transition from OPEN to HALF_OPEN if appropriate.
     */
    canRequest(): boolean {
        if (this.state === CircuitBreakerState.CLOSED) {
            return true;
        }

        if (this.state === CircuitBreakerState.OPEN) {
            if (Date.now() >= this.lastFailureTime + this.config.resetTimeout) {
                // Transition to HALF_OPEN when reset timeout elapses
                this.state = CircuitBreakerState.HALF_OPEN;
                this.halfOpenRequests = 0;
                return true;
            }
            return false;
        }

        if (this.state === CircuitBreakerState.HALF_OPEN) {
            return this.halfOpenRequests < this.config.halfOpenMaxRequests;
        }

        return false;
    }

    /**
     * Records that a request is actually being sent.
     * This separates the state checking (canRequest) from side effects.
     */
    recordRequest(): void {
        if (this.state === CircuitBreakerState.HALF_OPEN) {
            this.halfOpenRequests++;
        }
    }

    /**
     * Call this when a request succeeds (status < 500).
     */
    onSuccess(): void {
        this.failureCount = 0;
        this.state = CircuitBreakerState.CLOSED;
        this.halfOpenRequests = 0;
    }

    /**
     * Call this when a request fails (status >= 500 or network error).
     * @param error Optional error object
     */
    onFailure(error?: unknown): void {
        this.failureCount++;
        this.lastFailureTime = Date.now();

        if (this.state === CircuitBreakerState.HALF_OPEN) {
            // A single failure in HALF_OPEN state trips the breaker again
            this.state = CircuitBreakerState.OPEN;
            return;
        }

        if (this.failureCount >= this.config.failureThreshold) {
            this.state = CircuitBreakerState.OPEN;
        }
    }

    /**
     * Returns the current state, evaluating timeouts if currently OPEN.
     */
    getState(): CircuitBreakerState {
        if (this.state === CircuitBreakerState.OPEN) {
            if (Date.now() >= this.lastFailureTime + this.config.resetTimeout) {
                this.state = CircuitBreakerState.HALF_OPEN;
                this.halfOpenRequests = 0;
            }
        }
        return this.state;
    }
}
