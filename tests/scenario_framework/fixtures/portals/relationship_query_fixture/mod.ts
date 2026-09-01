/**
 * @module RelationshipQueryFixture
 * @path tests/scenario_framework/fixtures/portals/relationship_query_fixture/mod.ts
 * @description Fixture portal for the tools-relationship-query scenario (phase-175 Step 5):
 *   a real, tiny entrypoint importing a services/ layer file, so a real portal analyze run
 *   populates a real layer_contains_file edge and a real file_imports_file_internal edge for
 *   query_relationships/who_depends_on to exercise end to end.
 */
import { greet } from "./services/greeter.ts";

export function start(): string {
  return greet("world");
}
