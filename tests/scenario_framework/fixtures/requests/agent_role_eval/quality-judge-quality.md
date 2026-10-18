# Assess the portal agent whitelist

Evaluate the current `PortalPermissionsService.checkAgentAllowed` method below. Assess missing-portal denial, wildcard handling, explicit agent-role matching, and error clarity. Separate confirmed behavior from risks that require inspection of other methods. Do not claim this method alone enforces file-path confinement. Do not modify code.

Return an assessment artifact with a title, description, and an `analysis` object. Put the verdict, supporting evidence, and recommended regression tests in `analysis.recommendations`. No execution actions are required for this evaluation.

## Evidence

This is the method from `packages/portal/src/portal_permissions.ts`. The enclosing service stores portal configurations by alias. The other service methods are outside this evaluation.

```typescript
class PortalPermissionsService {
  checkAgentAllowed(portalAlias: string, agentRole: string): IAgentWhitelistResult {
    const portal = this.portals.get(portalAlias);

    if (!portal) {
      return {
        allowed: false,
        reason: `Portal '${portalAlias}' not found`,
        portal: portalAlias,
        agent_role: agentRole,
      };
    }

    // Check if agent is in whitelist
    const agentRolesAllowed = portal.agents_allowed || ["*"];

    // Wildcard allows all agents
    if (agentRolesAllowed.includes("*")) {
      return {
        allowed: true,
        portal: portalAlias,
        agent_role: agentRole,
      };
    }

    // Check explicit whitelist
    if (agentRolesAllowed.includes(agentRole)) {
      return {
        allowed: true,
        portal: portalAlias,
        agent_role: agentRole,
      };
    }

    return {
      allowed: false,
      reason: `Agent '${agentRole}' is not allowed to access portal '${portalAlias}'`,
      portal: portalAlias,
      agent_role: agentRole,
    };
  }

}
```
