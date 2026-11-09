# Two-caller duplicate write fixture

Both callers submit the same logical row. One caller writes one row. With two
concurrent callers, both check for an existing commit before either writes,
so both append the row. The barriers make that interleaving reproducible.
`run-tests.sh` checks the two-caller outcome and fails before the bug is fixed.
