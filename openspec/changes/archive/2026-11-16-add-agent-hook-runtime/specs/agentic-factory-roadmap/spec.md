## ADDED Requirements

### Requirement: Local hook follow-ons use two sequential implementation changes

The local hook work SHALL use add-agent-hook-runtime followed by add-agent-workflow-automation. Both MAY be proposed together; the latter MUST NOT enter apply before the former is merged and archived. These additive integrations MUST preserve the existing phase/role pipeline and MUST NOT initiate the external platform scope of Phase 4. Platform gaps SHALL be reported with manual fallbacks rather than claimed as equivalent native capabilities.

#### Scenario: Independent first delivery
- **WHEN** add-agent-hook-runtime is delivered without the second change
- **THEN** opt-in context delivery, recovery facts and capability diagnostics are usable without enabling workflow enforcement

#### Scenario: Planned dependency is not execution permission
- **GIVEN** both hook proposals exist and runtime is not merged and archived
- **WHEN** add-agent-workflow-automation is considered for apply
- **THEN** runtime completion is a prerequisite and the second change remains planning-only
- **AND** the earlier numbered roadmap phases and their original sequencing requirements remain unchanged

#### Scenario: Local adapters do not launch Phase 4
- **WHEN** hook scope is checked
- **THEN** it contains no external orchestration runtime, Control Plane API, hosted audit service, dashboard, RBAC, or sandbox
- **AND** unsupported Cursor/Amp/Claude native events are explicitly documented with the portable manual workflow
