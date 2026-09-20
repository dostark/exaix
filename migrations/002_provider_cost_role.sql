-- up
ALTER TABLE provider_costs ADD COLUMN agent_role TEXT;

-- down
ALTER TABLE provider_costs DROP COLUMN agent_role;
