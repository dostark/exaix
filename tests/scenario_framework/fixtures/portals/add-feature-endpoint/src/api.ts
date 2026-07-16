/**
 * @module AddFeatureEndpointFixtures
 * @path tests/scenario_framework/fixtures/portals/add-feature-endpoint/src/api.ts
 * @description Fixture portal: minimal API scaffold with stub handlers for CRUD operations.
 */

// deno-lint-ignore-file no-explicit-any
export interface IRequest {
  body: any;
  params: Record<string, string>;
}

export interface IResponse {
  json(body: any): void;
  status(code: number): IResponse;
}

export function handleGetUser(req: IRequest, res: IResponse): void {
  const userId = req.params.id;
  res.json({ id: userId, name: "placeholder" });
}

export function handleCreateUser(_req: IRequest, res: IResponse): void {
  res.status(201).json({ success: true });
}
