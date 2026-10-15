# @exaix/shared

Constants shared by `@exaix/core` and `@exaix/schemas`.

`core` and `schemas` depend on each other for defaults, so their duplicated
path and limit constants live here, below both packages, to keep the import
graph acyclic.
