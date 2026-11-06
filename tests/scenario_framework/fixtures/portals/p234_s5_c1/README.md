# Project facts

case_id: p234-s5-c1
The notes CLI has a renderCount(count) formatter. It currently renders count 0 as an empty string.
Specify a bug fix for notes readers. The approved results are:
- renderCount(0) returns "0 items".
- renderCount(1) still returns "1 item".
- renderCount(2) still returns "2 items".
Success means these three checks pass without changing other behavior.
Storage, authorization, CLI arguments, and output for other counts are outside scope.
These are the complete acceptance criteria; there is no unresolved product choice.
