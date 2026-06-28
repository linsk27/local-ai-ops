# Changelog

## v0.3.0 - 2026-06-28

- Added a local knowledge base page for database-backed operations Q&A without sending data to an LLM by default.
- Added an asset graph page that visualizes stored and inferred relationships between domains, DNS records, and servers.
- Added a renewal center that aggregates expiration, auto-renewal state, source, and Alibaba Cloud console links.
- Added read-only API endpoints for knowledge summaries, knowledge queries, asset graph data, and renewal center data.
- Added backend tests for renewal aggregation, local knowledge answers, and inferred DNS-to-server graph edges.
- Kept screenshots out of the public README to avoid exposing real local asset data.

## v0.2.1 - 2026-06-28

- Documented why public README screenshots must be sanitized before publishing.
- Removed real-environment screenshots from the release path to avoid exposing asset names, public IPs, regions, and renewal data.
- Verified the repository ignores local secrets, databases, generated outputs, and build artifacts.
- Confirmed backend tests and frontend builds pass locally and in GitHub Actions.
- Published a follow-up release tag without rewriting the existing v0.2.0 tag.

## v0.2.0 - 2026-06-23

- Added single-admin local login with Bearer token protection for API routes.
- Added default check creation for server, domain, DNS, and OSS assets.
- Clarified local refresh versus Alibaba Cloud asset sync semantics.
- Triggered runtime usage collection after SSH credentials are saved.
- Improved table pagination, action alignment, toast placement, and login UI.
- Added CI for backend tests and frontend builds.
- Documented LAN deployment, SSH first-time setup, API usage, and security notes.

## v0.1.0 - 2026-06-16

- Initial local Alibaba Cloud AI operations MVP.
- Added cloud accounts, asset sync, monitoring checks, alerts, AI diagnosis, encrypted secrets, and Docker Compose startup.
