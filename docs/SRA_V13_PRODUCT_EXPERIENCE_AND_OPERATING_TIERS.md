# SRA V13 — Product Experience & Operating Tier Architecture

## Core rule

One Identity → One Universal Account → Multiple Capabilities → One Active Operating Tier → One Workspace → Tier-Aware Sane Context.

The user never changes identity when changing workspaces. The current operating tier determines navigation, permissions, home experience, and the meaning Sane applies to the user’s request.

## Operating tiers

### Universal
Free permanent base account.

Workspace focus:
- Marketplace
- My Positions
- Activity
- Capabilities
- Sane

### Asset Provider
Paid capability for bringing productive assets into SRA.

Workspace focus:
- V4V Exchange
- Asset Accounts
- Verified Value
- Projects
- True Bills
- Completion

### Market Professional
Paid capability for supplying capital, services, equipment, materials, or contract capacity.

Workspace focus:
- Open Opportunities
- Projects
- My Positions
- Due Diligence
- True Bills

### Institutional Operator
Agreement-based institutional capability.

Workspace focus:
- V4V Review
- Custody & Records
- Verified Value
- Settlement and discharge operations
- Institutional lifecycle activity

### Platform Administration
Internal capability connecting SRA to the parent platform.

Workspace focus:
- SRA Platform Account
- Parent-platform connection
- Platform funding
- Treasury and market pools
- Cross-platform reporting

## Product experience

The public entry point asks what the visitor wants to accomplish instead of asking them to choose an account type.

Common goals:
- Participate
- Bring an asset
- Offer professional capacity
- Explore Verified Value

Every signup receives a free Universal Account. Paid or authorized capabilities can be added later. Active capabilities appear as selectable operating tiers in the Current Workspace selector.

## Sane context

Every Sane request includes the current operating tier. Sane interprets the same words differently according to the active workspace.

Examples:

- Universal: opportunities, comparison, participation, positions.
- Asset Provider: V4V, asset intake, projects, publishing, completion.
- Market Professional: capacity, assignments, contracts, deployment, settlement.
- Institutional: custody, collateral, filing, settlement, setoff, discharge.
- Platform Administration: platform account, parent connection, treasury, funding, reporting.

## Version status

Health version: `1.3.0`

V13 components:
- Product Experience: ACTIVE
- Operating Tier Engine: ACTIVE
- Tier-Aware Sane: ACTIVE
- Universal Account: FREE
- Capability Tiers: ACTIVE
