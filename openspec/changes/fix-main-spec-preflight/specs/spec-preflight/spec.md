## ADDED Requirements

### Requirement: Validate projected main specs before review

Tier 1 SHALL validate all main specs after the planned delta sync with the consumer's installed OpenSpec in strict mode, once change validation and sync conflict checks pass. The preview MUST preserve working specs, run without package installation or telemetry, bound execution time/output, and clean up temporary files on success or failure.

#### Scenario: Long MODIFIED description fails before apply
- **GIVEN** a valid change with a MODIFIED description of 501 characters and OpenSpec 1.14.1
- **WHEN** gate-check runs the review pre-gate
- **THEN** projected main-spec validation fails and names the affected main spec after delta sync
- **AND** a 500-character description with longer scenarios passes the length check

#### Scenario: Existing blocker outside this change
- **GIVEN** an unchanged main spec fails strict validation
- **WHEN** the projected specs are validated
- **THEN** the gate fails and identifies that file as an existing main spec outside this change
- **AND** instructions require a separately scoped migration without disabling strict

#### Scenario: Removal fixes an existing invalid requirement
- **GIVEN** a delta removes an invalid requirement while retaining a valid requirement
- **WHEN** the preview is validated
- **THEN** the removed block does not produce a stale diagnostic
- **AND** the original main spec remains byte-identical

#### Scenario: Rename precedes modification
- **GIVEN** a delta renames a requirement and modifies it using the new name
- **WHEN** the preview is validated
- **THEN** validation reads the renamed and modified result from planSpecSync

### Requirement: Preserve validator severity and reject incomplete reports

The preview MUST treat ERROR and WARNING as blocking and INFO as advisory, preserving the installed OpenSpec's severity. Diagnostics SHALL identify the main-spec path and whether it is projected or unchanged. CLI failure, missing results, malformed JSON, or filesystem failure MUST fail the gate. The existing gate JSON contract SHALL remain unchanged.

#### Scenario: Old validator remains advisory
- **GIVEN** OpenSpec 1.4.1 emits INFO for a long description
- **WHEN** the preview runs
- **THEN** the finding is shown in human-readable output and does not fail the gate

#### Scenario: Failed or incomplete validator output
- **WHEN** the preview CLI fails or returns malformed/incomplete JSON
- **THEN** the gate fails with an explanation and removes the temporary preview

### Requirement: Author concise descriptions without losing behavior

Authoring templates SHALL explain that 500 characters applies to each requirement description, excluding headings and scenarios. New requirements SHALL describe one behavior with examples in scenarios. Existing MODIFIED headings, scenarios, and behavior MUST be preserved; splitting legacy descriptions SHALL require a separately scoped migration.

#### Scenario: Updated consumer instructions
- **WHEN** kit init or update installs authoring instructions
- **THEN** architect, propose, workflow, and howto instructions expose the limit and separate migration guidance
- **AND** existing consumer specs and config are not rewritten by update

### Requirement: New capability Purpose passes strict validation

The sync plan SHALL create a Purpose meeting OpenSpec's minimum length even when the capability and change names each contain one character.

#### Scenario: Short names
- **GIVEN** change x adds a requirement to new capability a
- **WHEN** its main spec is planned
- **THEN** the generated Purpose passes strict validation
