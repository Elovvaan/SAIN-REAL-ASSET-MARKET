# SRA Account Model

## Governing Principle

Every person or organization has one Universal Identity and one Universal Account. Specialized account capacities are added to that identity rather than creating separate logins.

## Account Classes

### Universal Account
The standard marketplace account. It can browse opportunities, fund eligible positions, track balances and positions, receive settlement, view activity, and use Sane.

### Asset Provider Capacity
Allows the Universal Identity to start V4V, present private evidence, manage productive Asset Accounts, create projects, and publish opportunities.

### Market Professional Capacity
Allows the Universal Identity to contribute capital, services, materials, equipment, or contract rights through professional marketplace tools.

### Institutional Operator Capacity
Invitation- or approval-based access to V4V review, custody, Verified Value administration, collateral schedules, instrument operations, settlement, setoff, discharge, and audit.

### Platform Administration Capacity
Internal administrative access to the SRA Platform Account and its connection to the parent platform.

## Non-User Operational Accounts

### Asset Account
The permanent institutional record of a productive asset. It is not the owner's login account.

### Project Account
The operating container for one project, including participants, positions, contributions, milestones, instruments, completion, settlement, and closure.

### Platform Account
The administrative account connecting SRA to the parent platform. It appears only in the institutional administration shell.

## Relationship

```text
Universal Identity
  └── Universal Account
      ├── Asset Provider Capacity
      ├── Market Professional Capacity
      ├── Institutional Operator Capacity
      └── Platform Administration Capacity

Asset Provider Capacity
  └── controls one or more Asset Accounts

Asset Account
  └── originates one or more Project Accounts

Universal and Professional Accounts
  └── create Participation Positions inside Project Accounts
```

## Prototype Behavior

New public signups receive a Universal Account only. Asset Provider and Market Professional capacities can be added from Account Capacities. Institutional and Platform Administration capacities cannot be self-activated.
