#!/usr/bin/env python3
"""Aimo Problem 1: Airline Departure Problem.

Three companies depart every 100, 120, and 150 days respectively.
Find the greatest positive integer d such that, regardless of how the
airlines choose their departure times (phases), there will always be at
least d consecutive days without a flight.

The full schedule repeats every LCM(100,120,150) = 600 days, so we model
days 0..599. For each choice of phases we compute the maximum run of
consecutive no-flight days (max gap between consecutive covered days,
including the wrap-around gap). We then take the minimum of that maximum
over all phase assignments - that minimum is the guaranteed value d.
"""

PERIODS = (100, 120, 150)
LCM = 600


def max_gap(a, b, c):
    """Return the maximum run of consecutive no-flight days for a given
    phase assignment (a mod 100, b mod 120, c mod 150)."""
    covered = set()
    for period, phase in zip(PERIODS, (a, b, c)):
        for day in range(phase, LCM, period):
            covered.add(day % LCM)
    points = sorted(covered)
    n = len(points)
    gaps = []
    for i in range(n):
        diff = (points[(i + 1) % n] - points[i]) % LCM
        gaps.append(diff - 1)
    return max(gaps)


def main():
    # WLOG fix the first company's phase to 0: shifting the whole schedule
    # in time does not change any of the gaps between departures.
    best = float("inf")
    best_config = None
    for b in range(PERIODS[1]):
        for c in range(PERIODS[2]):
            g = max_gap(0, b, c)
            if g < best:
                best = g
                best_config = (0, b, c)

    answer = best
    print("guaranteed max no-flight run:", answer)
    print("witness config (phase a,b,c):", best_config)
    with open("/app/results.txt", "w") as f:
        f.write(str(answer) + "\n")


if __name__ == "__main__":
    main()
