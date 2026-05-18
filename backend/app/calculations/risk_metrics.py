"""Risk metric calculations: VaR, CVaR, Greeks, DV01, duration.

All functions in this module are pure — they take numeric inputs and return
numeric outputs with no side-effects, making them trivially testable and
safe to parallelize inside simulation workers.
"""


def value_at_risk(returns: list[float], confidence: float = 0.95) -> float:
    """Placeholder: historical VaR at a given confidence level."""
    raise NotImplementedError


def conditional_value_at_risk(returns: list[float], confidence: float = 0.95) -> float:
    """Placeholder: CVaR (Expected Shortfall) at a given confidence level."""
    raise NotImplementedError


def dv01(cash_flows: list[float], discount_rates: list[float]) -> float:
    """Placeholder: Dollar Value of a Basis Point for a fixed-income instrument."""
    raise NotImplementedError
