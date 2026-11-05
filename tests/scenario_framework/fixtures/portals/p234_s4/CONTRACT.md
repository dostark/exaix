# Boundary clamp contract

`clamp(value, min, max)` returns:

- `min` when `value < min`.
- `max` when `value > max`.
- `value` otherwise.

Examples: `clamp(-1, 0, 10) === 0`, `clamp(11, 0, 10) === 10`, `clamp(5, 0, 10) === 5`.
