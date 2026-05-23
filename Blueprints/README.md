# Blueprints/

This directory contains **blueprints** - predefined templates and configurations for Exaix components.

## Structure

- **Agents/**: Agent configuration blueprints defining personas, capabilities, and behaviors
- **Flows/**: Flow orchestration blueprints defining multi-step processes and workflows
- **Skills/**: Skill capability blueprints defining procedural knowledge and expertise

## Purpose

Blueprints provide reusable templates that can be instantiated and customized for specific use cases, separating configuration from implementation.

## Migration Notes

- Skills were migrated from `Memory/Skills/core/` to `Blueprints/Skills/` to properly separate predefined blueprints from learned memory
