from datetime import date, timedelta


def business_days_between(start: date, end: date) -> int:
    """Count weekday (Mon–Fri) days between two dates, exclusive of end."""
    count = 0
    current = start
    while current < end:
        if current.weekday() < 5:
            count += 1
        current += timedelta(days=1)
    return count


def add_business_days(start: date, n: int) -> date:
    """Return the date n business days after start."""
    current = start
    added = 0
    while added < n:
        current += timedelta(days=1)
        if current.weekday() < 5:
            added += 1
    return current
