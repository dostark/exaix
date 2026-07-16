# Fix null-safety bugs in UserService

The file `src/user_service.ts` has two functions with null-safety bugs:

1. `formatUserName` crashes when `user` is null or undefined
2. `sendWelcomeEmail` accesses `user.name` without checking if `user` exists

Add proper null guards using optional chaining and null checks.
The function signatures should remain unchanged.
