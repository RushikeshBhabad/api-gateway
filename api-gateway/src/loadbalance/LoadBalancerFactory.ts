import { LoadBalancerStrategy } from './LoadBalancerStrategy';
import { RoundRobinStrategy } from './RoundRobinStrategy';
import { WeightedRoundRobinStrategy } from './WeightedRoundRobinStrategy';
import { LeastConnectionsStrategy } from './LeastConnectionsStrategy';
import { RandomStrategy } from './RandomStrategy';
import { ConsistentHashingStrategy } from './ConsistentHashingStrategy';

export type StrategyName = 'ROUND_ROBIN' | 'WEIGHTED_ROUND_ROBIN' | 'LEAST_CONNECTIONS' | 'RANDOM' | 'CONSISTENT_HASHING';

/**
 * Factory class for creating and managing load balancer strategies.
 */
export class LoadBalancerFactory {
  private static registry = new Map<string, () => LoadBalancerStrategy>([
    ['ROUND_ROBIN', () => new RoundRobinStrategy()],
    ['WEIGHTED_ROUND_ROBIN', () => new WeightedRoundRobinStrategy()],
    ['LEAST_CONNECTIONS', () => new LeastConnectionsStrategy()],
    ['RANDOM', () => new RandomStrategy()],
    ['CONSISTENT_HASHING', () => new ConsistentHashingStrategy()],
  ]);

  /**
   * Creates a load balancer strategy based on the provided name or environment configuration.
   * 
   * @param name - Optional name of the strategy to create. If not provided,
   *               it reads from process.env.LOAD_BALANCER_STRATEGY, defaulting to 'ROUND_ROBIN'.
   * @returns An instance of a LoadBalancerStrategy.
   */
  static create(name?: string): LoadBalancerStrategy {
    const strategyName = (name || process.env.LOAD_BALANCER_STRATEGY || 'ROUND_ROBIN').toUpperCase();
    const factory = this.registry.get(strategyName);
    
    if (!factory) {
      console.warn(`[LB] Unknown strategy '${strategyName}', falling back to ROUND_ROBIN`);
      // Use the factory from the registry for ROUND_ROBIN to ensure consistency if it was overridden
      const fallbackFactory = this.registry.get('ROUND_ROBIN') || (() => new RoundRobinStrategy());
      return fallbackFactory();
    }
    
    console.log(`[LOAD-BALANCER] Strategy initialized: ${strategyName}`);
    return factory();
  }

  /**
   * Registers a custom strategy with the factory.
   * 
   * @param name - The name of the strategy to register.
   * @param factory - A factory function that returns an instance of the strategy.
   */
  static register(name: string, factory: () => LoadBalancerStrategy): void {
    this.registry.set(name.toUpperCase(), factory);
  }
}
