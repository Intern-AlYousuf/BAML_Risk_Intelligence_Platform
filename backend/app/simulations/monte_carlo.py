"""Monte Carlo simulation engine.

Entry point for all stochastic simulation work. Concrete engines
(GBM, mean-reversion, jump-diffusion) will be implemented as subclasses
of the base runner and registered here.
"""
from dataclasses import dataclass


@dataclass
class MonteCarloConfig:
    iterations: int = 10_000
    time_steps: int = 252
    seed: int | None = None


class MonteCarloRunner:
    """Placeholder Monte Carlo runner.

    Activated when ENABLE_MONTE_CARLO feature flag is true.
    """

    def __init__(self, config: MonteCarloConfig) -> None:
        self.config = config

    def run(self) -> dict:
        raise NotImplementedError("Monte Carlo engine not yet implemented")
