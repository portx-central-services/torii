## ADDED Requirements

### Requirement: OIDC sign-in
The system SHALL support sign-in via Google OIDC AND Okta OIDC. The configured providers MUST be selectable via environment variables (`AUTH_PROVIDERS=google,okta`). On successful authentication, the system MUST establish a signed, HTTP-only session cookie scoped to the Torii domain. Session lifetime MUST be 8 hours of inactivity; sessions MUST auto-extend on each authenticated request.

#### Scenario: Successful Google sign-in
- **GIVEN** the user is not signed in and `AUTH_PROVIDERS` includes `google`
- **WHEN** they choose "Sign in with Google" and complete the consent flow
- **THEN** the system sets a session cookie, redirects them to the originally requested URL (or `/projects` by default), and the user is recognized as authenticated on subsequent requests

#### Scenario: Sign-in with disabled provider
- **GIVEN** `AUTH_PROVIDERS=google` (Okta disabled)
- **WHEN** an unauthenticated user navigates to `/auth/okta`
- **THEN** the system returns `404` and no Okta flow is initiated

### Requirement: Domain restriction
The system SHALL reject sign-ins from email domains not present in the `ALLOWED_EMAIL_DOMAINS` environment variable. If `ALLOWED_EMAIL_DOMAINS` is empty, all authenticated emails MUST be allowed.

#### Scenario: Reject non-allowed domain
- **GIVEN** `ALLOWED_EMAIL_DOMAINS=portx.io`
- **WHEN** a Google sign-in succeeds for `someone@external.example`
- **THEN** the system terminates the sign-in, does not create a session, and renders an "access denied" page

### Requirement: Role-based access control
The system SHALL assign every Person a `role` of `PM` or `Viewer`. The default role on first sign-in MUST be `Viewer`. Only requests authenticated as `PM` MUST be allowed to perform write operations (`POST`, `PATCH`, `DELETE`) on projects, allocations, and tracker connections. The system MUST return `403` for write operations by `Viewer` users.

#### Scenario: Viewer attempts to create a project
- **GIVEN** an authenticated `Viewer`
- **WHEN** they submit `POST /api/projects`
- **THEN** the system returns `403` and does NOT create a project

#### Scenario: PM creates a project successfully
- **GIVEN** an authenticated `PM`
- **WHEN** they submit `POST /api/projects` with valid input
- **THEN** the system returns `201` with the new project

### Requirement: Sign-out
The system SHALL provide a sign-out action that invalidates the session cookie immediately and revokes the server-side session record.

#### Scenario: User signs out
- **GIVEN** an authenticated user
- **WHEN** they invoke the sign-out action
- **THEN** the session cookie is cleared, the server-side session is deleted, and subsequent requests with the prior session id are rejected as unauthenticated
