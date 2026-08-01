# SRA V16 — Public Home Experience

## Permanent Product Decision

The signed-out SRA experience is the permanent public front door of the platform.

Visitors do not land inside an authenticated dashboard. They enter through a public marketplace experience with Sane centered as the guide and public opportunity cards visible alongside it.

## Flow

```text
Visitor
  -> Public Home Experience
  -> Ask Sane
  -> Explore or compare public opportunities
  -> Decide whether to create a free Universal Account
  -> Sign in or sign up
  -> Enter the authenticated operating workspace
```

## Public Home Responsibilities

- Display public marketplace status.
- Display approved public opportunity summaries.
- Keep each opportunity independently clickable.
- Let Sane explain, compare, and guide.
- Help a visitor decide whether to create a free Universal Account.
- Route existing users to sign in.
- Route new users to free Universal Account signup.

## Public Home Restrictions

The signed-out experience must not expose:

- internal skill names;
- execution plans;
- private evidence;
- V4V review records;
- custody records;
- collateral schedules;
- settlement records;
- discharge records;
- administrative or institutional tools.

## Sane Public Context

Sane operates as a public marketplace guide before authentication. It may explain SRA, compare public summaries, help visitors understand participation, and route to signup or sign-in.

The internal agent and skill architecture remains hidden.

## Permanent UI Contract

The public layout retains:

- public marketplace summary across the top;
- Sane centered in the primary workspace;
- clickable opportunity cards in the right-side market rail;
- sign-in and free-account actions in the public header;
- no authenticated sidebar or internal navigation.

## Authenticated Transition

After authentication, the Public Home Experience yields to the user's active operating tier workspace. Signing out returns the user to the same permanent Public Home Experience.

## Implementation

`public/public-home.js` marks and binds the V16 public state independently from authenticated workspace code.

The signed-out page carries:

```text
data-public-home="active"
data-public-home-version="V16"
```

This allows future UI changes to preserve the public front-door contract.
