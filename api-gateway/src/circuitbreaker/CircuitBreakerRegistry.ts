import { CircuitBreaker, CircuitBreakerConfig } from './CircuitBreaker';

export class CircuitBreakerRegistry {
    private breakers = new Map<string, CircuitBreaker>();
    private config: CircuitBreakerConfig;
    private enabled: boolean;

    constructor() {
        this.enabled = process.env.CIRCUIT_BREAKER_ENABLED === 'true';
        this.config = {
            failureThreshold: parseInt(process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD || '5', 10),
            resetTimeout: parseInt(process.env.CIRCUIT_BREAKER_RESET_TIMEOUT || '10000', 10),
            halfOpenMaxRequests: parseInt(process.env.CIRCUIT_BREAKER_HALF_OPEN_MAX_REQUESTS || '1', 10),
        };
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    get(instanceId: string): CircuitBreaker {
        if (!this.breakers.has(instanceId)) {
            this.breakers.set(instanceId, new CircuitBreaker(this.config));
        }
        return this.breakers.get(instanceId)!;
    }

    // Helper to reload configuration (useful for testing)
    reloadConfig(): void {
        this.enabled = process.env.CIRCUIT_BREAKER_ENABLED === 'true';
        this.config = {
            failureThreshold: parseInt(process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD || '5', 10),
            resetTimeout: parseInt(process.env.CIRCUIT_BREAKER_RESET_TIMEOUT || '10000', 10),
            halfOpenMaxRequests: parseInt(process.env.CIRCUIT_BREAKER_HALF_OPEN_MAX_REQUESTS || '1', 10),
        };
    }

    // Clear registry for testing
    clear(): void {
        this.breakers.clear();
    }
}

export const circuitBreakerRegistry = new CircuitBreakerRegistry();
