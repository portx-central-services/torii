## REMOVED Requirements

### Requirement: App is wrapped in an OIDC AuthProvider
**Reason**: Inherited from a Next.js portal-ui application; Torii does not use a browser-side `react-oidc-context`-style provider — the API is the OIDC client.
**Migration**: See ADDED requirement "Backend-driven OIDC code flow against Keycloak" and "Web sign-in surface and route guard".

### Requirement: Tokens are stored in sessionStorage
**Reason**: Tokens never leave the API in Torii; the browser does not store ID or access tokens.
**Migration**: Replaced by server-side `Session` rows + signed `torii_sess` cookie; see ADDED requirement "Server-side session cookie identifies the authenticated user".

### Requirement: useAuth exposes access token, user identity, and auth actions
**Reason**: Torii has no `useAuth()` hook of this shape and no token-bearing client surface.
**Migration**: The web app reads identity via `GET /api/me` (existing endpoint); sign-in/out actions are page navigations to the API auth routes. See ADDED requirement "Web sign-in surface and route guard".

### Requirement: RequireAuth wrapper guards authenticated routes
**Reason**: Wraps Next.js `app/portal/**` and references `<SigninShell>`, neither of which exists in Torii.
**Migration**: Replaced by Torii's `<RequireAuth>` component routing unauthenticated users to the sign-in screen; see ADDED requirement "Web sign-in surface and route guard".

### Requirement: authedFetch helper attaches the bearer token
**Reason**: Torii's API uses a session cookie; no Bearer token is attached client-side.
**Migration**: The shared `api` client sends `credentials: 'include'` so the session cookie is carried automatically. See ADDED requirement "Server-side session cookie identifies the authenticated user".

### Requirement: Sign out ends the OIDC session
**Reason**: Sign-out semantics described here (browser-side `signoutRedirect()`, `revokeTokensOnSignout`, `markSignoutPending`) belong to the Next.js client library.
**Migration**: Replaced by `POST /api/auth/signout` clearing the local session and redirecting to Keycloak's end-session endpoint; see ADDED requirement "Sign-out ends both the Torii session and the Keycloak SSO session".

### Requirement: Configuration is sourced from public env vars
**Reason**: Refers to `NEXT_PUBLIC_*` env vars and a Next.js `auth config` module; Torii reads its OIDC config server-side from non-public env vars.
**Migration**: Replaced by ADDED requirement "Auth configuration via server-side env vars".

### Requirement: Local dev server runs on a port the realm allowlists
**Reason**: Concerns the Next.js dev server on port 3000 and the `portal-ui` Keycloak client; Torii's API runs on port 3001 and uses a different Keycloak client.
**Migration**: Replaced by ADDED requirement "Realm allowlists the Torii callback URL" which states the required client allowlist entry in environment-neutral terms.

### Requirement: Browser-facing API Catalog calls go through a Next.js rewrites proxy
**Reason**: Describes a portal-ui-specific rewrite to an unrelated API Catalog backend; Torii has no equivalent proxy and no API Catalog dependency.
**Migration**: No replacement — out of scope for Torii.

### Requirement: Only authenticated portal routes are guarded
**Reason**: Refers to Next.js `/portal/**` and `/api-docs` routes that do not exist in Torii.
**Migration**: Replaced by ADDED requirement "Web sign-in surface and route guard" which guards the entire Torii web app except the sign-in screen.

### Requirement: AuthProvider config sets post_logout_redirect_uri to bare origin
**Reason**: References the Next.js OIDC AuthProvider config object that does not exist in Torii.
**Migration**: Torii constructs the Keycloak end-session URL server-side; see ADDED requirement "Sign-out ends both the Torii session and the Keycloak SSO session".

### Requirement: AuthProvider config enables silent renewal via static callback
**Reason**: Browser-side silent renewal does not apply — Torii's session is a server-side cookie with sliding expiry.
**Migration**: Replaced by the existing sliding-expiry behavior on `Session` rows; no separate requirement is needed.

### Requirement: AuthProvider config enables token revocation on signout
**Reason**: Browser-side token revocation does not apply — Torii holds no browser-side tokens.
**Migration**: Sign-out deletes the server-side Session and ends the Keycloak SSO session; see ADDED requirement "Sign-out ends both the Torii session and the Keycloak SSO session".

### Requirement: Token-expired-at-mount attempts silent renewal first
**Reason**: TokenSync / silent-renewal behavior is specific to the browser-side OIDC library.
**Migration**: Torii's sessions extend on every authenticated request (sliding expiry on `Session.expiresAt`); when a session expires, the API returns 401 and the web app routes to the sign-in screen.

### Requirement: Auth recovery is environment-uniform
**Reason**: References TokenSync and `<SigninShell>` recovery branches in the Next.js application.
**Migration**: Replaced by ADDED requirement "Web sign-in surface and route guard" — the unauth path is the same on localhost and deployed origins.

## ADDED Requirements

### Requirement: Backend-driven OIDC code flow against Keycloak
The Torii API SHALL act as a confidential OIDC client against the configured Keycloak realm. On `GET /api/auth/keycloak/login` the API SHALL redirect the user to Keycloak's authorize endpoint with a CSRF-safe `state` value (stored in a signed, HttpOnly, short-lived cookie) and a PKCE code challenge. On `GET /api/auth/keycloak/callback` the API SHALL validate the `state` against the cookie, exchange the code for tokens against Keycloak's token endpoint, verify the ID token's signature and standard claims (issuer, audience, expiry, nonce when used), and then invoke the shared `handleSignin(claims)` path with the email, name, and `email_verified` claims.

Access and ID tokens MUST NOT be returned to the browser. They MAY be retained server-side only for as long as needed to perform the exchange and verification.

#### Scenario: Login initiates the Keycloak authorize flow
- **WHEN** an unauthenticated browser requests `GET /api/auth/keycloak/login`
- **THEN** the API responds with a 302 redirect to the configured Keycloak realm's authorize endpoint
- **AND** a signed `state` cookie is set
- **AND** the redirect URL includes a PKCE `code_challenge` and the matching `state` value

#### Scenario: Callback exchanges the code and creates a session
- **GIVEN** a successful Keycloak authorize round trip with valid `code` and `state`
- **WHEN** Keycloak redirects to `GET /api/auth/keycloak/callback?code=…&state=…`
- **THEN** the API verifies the `state` matches the cookie, exchanges the code for tokens, verifies the ID token, and calls `handleSignin` with the resulting claims
- **AND** if `handleSignin` returns `status: 'ok'`, the API sets the signed `torii_sess` cookie and redirects to `WEB_BASE_URL`

#### Scenario: State mismatch rejects the callback
- **WHEN** the `state` query parameter does not match the signed state cookie value
- **THEN** the API returns 400 and does NOT call the token endpoint

#### Scenario: ID token verification failure rejects sign-in
- **WHEN** the ID token's signature, issuer, or audience does not validate against the configured Keycloak issuer and client id
- **THEN** the API returns 400 and does NOT create a Session

### Requirement: Server-side session cookie identifies the authenticated user
After successful sign-in the API SHALL persist a `Session` row keyed by the new user's `Person.id` and issue a signed, HttpOnly `torii_sess` cookie carrying the session id. Every subsequent authenticated request SHALL be identified by reading and validating this cookie server-side; the browser never sees access or ID tokens. Cookie attributes MUST include `HttpOnly`, `SameSite=Lax`, and `Secure` when `NODE_ENV=production`, and the cookie MUST be signed using the existing `SESSION_SECRET`.

#### Scenario: Authenticated request carries the session cookie
- **GIVEN** a signed-in user
- **WHEN** the browser makes any request to `/api/*` with the `torii_sess` cookie
- **THEN** the API resolves `request.user` from the `Session` + `Person` join and processes the request normally

#### Scenario: Missing or invalid cookie yields unauthenticated
- **WHEN** a request reaches `/api/*` without a valid `torii_sess` cookie
- **THEN** the API processes the request as unauthenticated; protected routes return 401

#### Scenario: Tokens are not exposed to the browser
- **WHEN** a sign-in completes
- **THEN** no access token, ID token, or refresh token appears in any response body, header (other than `Set-Cookie`), URL fragment, or browser-readable storage

### Requirement: Person provisioning on first sign-in
On every successful sign-in the system SHALL upsert a `Person` row by lowercased email: creating it with `role = Viewer` and the claims-provided `name` on first sign-in, and updating `name` on subsequent sign-ins. Promotion to `role = PM` MUST NOT occur automatically as part of sign-in; it is a Torii-side operation by an admin.

#### Scenario: First sign-in creates a Viewer
- **GIVEN** a Keycloak user whose email has never signed in to Torii before
- **WHEN** their sign-in completes
- **THEN** a new `Person` row is created with `role = Viewer`. Torii does NOT gate sign-in on the upstream `email_verified` claim — Keycloak is the sole IdP-of-trust and `ALLOWED_EMAIL_DOMAINS` provides the access gate (the right place to enforce email verification is the realm's identity-provider "Trust Email" setting)

#### Scenario: Subsequent sign-in updates name only
- **GIVEN** an existing `Person` with `role = PM`
- **WHEN** they sign in again
- **THEN** the `Person.name` is updated from the claims but `Person.role` is NOT changed

### Requirement: Email-domain gate restricts sign-in
The `ALLOWED_EMAIL_DOMAINS` environment variable SHALL be a comma-separated allowlist of email domains. When non-empty, sign-in MUST be rejected for any email whose domain (case-insensitive) is not in the list; rejection MUST happen before any `Person` row is created or updated. When the list is empty, the gate is disabled (for dev/test convenience).

#### Scenario: Allowed domain proceeds
- **GIVEN** `ALLOWED_EMAIL_DOMAINS="portx.io"` and a Keycloak user `alice@portx.io`
- **WHEN** sign-in completes
- **THEN** the Person is upserted and a Session is created

#### Scenario: Disallowed domain is rejected
- **GIVEN** `ALLOWED_EMAIL_DOMAINS="portx.io"` and a Keycloak user `eve@example.com`
- **WHEN** the API processes the callback claims
- **THEN** no Person row is created or updated, no Session is issued, and the API responds with a sign-in-failed indicator

### Requirement: Admin allowlist sets Person.isAdmin
The `ADMIN_EMAILS` environment variable SHALL be a comma-separated allowlist of emails that confer admin privileges. On every successful sign-in the API SHALL reconcile `Person.isAdmin` to `true` if and only if the user's email (case-insensitive) appears in `ADMIN_EMAILS`. The role itself (`PM`/`Viewer`) is unaffected by this reconciliation.

#### Scenario: Email in allowlist becomes admin on sign-in
- **GIVEN** `ADMIN_EMAILS="alice@portx.io"` and a Person whose `isAdmin` is `false`
- **WHEN** Alice signs in
- **THEN** her `Person.isAdmin` is updated to `true` and her session reflects admin

#### Scenario: Email removed from allowlist is demoted on next sign-in
- **GIVEN** a previously-admin Person whose email is no longer in `ADMIN_EMAILS`
- **WHEN** they sign in again
- **THEN** their `Person.isAdmin` is updated to `false`

### Requirement: Web sign-in surface and route guard
The web app SHALL render a sign-in screen at `/signin` containing a single primary action that navigates the browser to `GET /api/auth/keycloak/login`. All other routes in the web app SHALL be wrapped in a guard that, when `GET /api/me` reports unauthenticated, redirects the user to `/signin`. The sign-in screen MUST be the only publicly reachable route.

#### Scenario: Unauthenticated user is routed to sign-in
- **GIVEN** a browser with no `torii_sess` cookie
- **WHEN** the user opens any non-`/signin` route in the web app
- **THEN** the app redirects to `/signin` and the user does NOT see protected content

#### Scenario: Sign-in button initiates the Keycloak flow
- **WHEN** the user clicks the primary action on `/signin`
- **THEN** the browser navigates to `GET /api/auth/keycloak/login`, which redirects to Keycloak

#### Scenario: Authenticated user lands on the requested route
- **GIVEN** a successful Keycloak round trip
- **WHEN** the API redirects back to `WEB_BASE_URL`
- **THEN** the web app finds a valid session via `/api/me` and renders the requested page

### Requirement: Sign-out ends both the Torii session and the Keycloak SSO session
The API SHALL expose `POST /api/auth/signout` which deletes the current `Session` row, clears the `torii_sess` cookie, and returns a Keycloak end-session URL configured with `post_logout_redirect_uri = ${WEB_BASE_URL}/signin`. The web app SHALL navigate the browser to that returned URL after the local cookie is cleared. Calling sign-out without an active session MUST be idempotent (no error).

#### Scenario: Sign-out clears local session and redirects to Keycloak end-session
- **GIVEN** a signed-in user
- **WHEN** the web app calls `POST /api/auth/signout`
- **THEN** the response clears the `torii_sess` cookie and includes an end-session URL pointing at Keycloak with `post_logout_redirect_uri` set to the sign-in screen
- **AND** the `Session` row is deleted from the database

#### Scenario: Sign-out without a session is a no-op
- **WHEN** an unauthenticated client calls `POST /api/auth/signout`
- **THEN** the API responds 200 with no side effects

### Requirement: Auth configuration via server-side env vars
The API SHALL read all OIDC configuration from server-side environment variables at startup: `KEYCLOAK_ISSUER` (full realm URL), `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET`, `KEYCLOAK_REDIRECT_URI`, plus the existing `ALLOWED_EMAIL_DOMAINS`, `SESSION_SECRET`, `SESSION_COOKIE_NAME`, and `WEB_BASE_URL`, and the new `ADMIN_EMAILS`. The previously declared `GOOGLE_*`, `OKTA_*`, and `AUTH_PROVIDERS` env vars MUST be removed (no longer read or referenced) since Keycloak is the sole IdP and Google is brokered upstream by Keycloak. None of these variables MAY be prefixed `VITE_` or otherwise exposed to the browser bundle.

#### Scenario: Missing Keycloak issuer fails fast in production
- **GIVEN** `NODE_ENV=production` and `KEYCLOAK_ISSUER` is unset or empty
- **WHEN** the API starts
- **THEN** the process exits with a non-zero status and a clear error mentioning `KEYCLOAK_ISSUER`

#### Scenario: Removed env vars are not consulted
- **WHEN** the API code is searched for references to `GOOGLE_CLIENT_ID`, `OKTA_ISSUER`, or `AUTH_PROVIDERS`
- **THEN** no such reference exists (other than in archived changes or this REMOVED record)

### Requirement: Realm allowlists the Torii callback URL
For Torii to complete the OIDC code flow, the Keycloak client configured for Torii MUST list `${WEB_BASE_URL}/api/auth/keycloak/callback` among its **Valid Redirect URIs** AND MUST list `${WEB_BASE_URL}/signin` (or `${WEB_BASE_URL}/*`) among its **Valid Post Logout Redirect URIs**. The callback intentionally targets the web origin — in dev the Vite proxy forwards `/api/*` to the API, and in prod the web and API share an origin — so a single allowlist entry covers both. These are operator-managed properties on the Keycloak side, not part of the Torii deploy. The Torii documentation (`docs/env.md` or the README) SHALL list these required allowlist entries alongside the `KEYCLOAK_*` env vars.

#### Scenario: Operator setup is documented
- **WHEN** an operator reads the Torii deploy docs
- **THEN** they find an explicit list of required Keycloak realm-client allowlist entries and matching env vars

#### Scenario: Missing allowlist surfaces a recognizable error
- **GIVEN** the Keycloak client does not include Torii's callback URL
- **WHEN** a user attempts to sign in
- **THEN** Keycloak returns its standard "Invalid redirect_uri" error and the Torii API logs the failure (no Person or Session is created)

### Requirement: Dev preview-admin bypass is opt-in only
The pre-existing dev preview-admin bypass (synthetic admin session in dev) MUST default OFF. Enabling it requires BOTH the web app build flag `VITE_DISABLE_AUTH=true` AND the API env flag `ENABLE_PREVIEW_ADMIN_BYPASS=true`. When `NODE_ENV=production` the API env flag MUST be rejected at startup, and the API MUST NOT honor the `torii_preview_admin` cookie in production regardless of any other setting.

#### Scenario: Default dev start uses real auth
- **GIVEN** a developer runs the dev stack without setting the bypass env vars
- **WHEN** they open the web app
- **THEN** they see the sign-in screen and must authenticate via Keycloak

#### Scenario: Bypass requires both web and API flags
- **GIVEN** only one of `VITE_DISABLE_AUTH` or `ENABLE_PREVIEW_ADMIN_BYPASS` is set
- **WHEN** the developer opens the app
- **THEN** they see the sign-in screen (the bypass does not activate)

#### Scenario: Bypass is hard-rejected in production
- **GIVEN** `NODE_ENV=production` and `ENABLE_PREVIEW_ADMIN_BYPASS=true`
- **WHEN** the API starts
- **THEN** the process exits with a non-zero status and a clear error

### Requirement: Tracker integrations remain independent of user sign-in
Tracker connections (currently Monday, future Jira) MUST continue to use their own provider-specific OAuth flows scoped to the tracker connection itself; user sign-in via Keycloak MUST NOT be required to share or impersonate a tracker authorization, and no Keycloak access/ID token MAY be forwarded to a tracker provider.

#### Scenario: Monday OAuth is unchanged by Keycloak sign-in
- **GIVEN** a Torii admin signed in via Keycloak
- **WHEN** they connect a Monday workspace
- **THEN** the existing Monday OAuth flow runs (Torii is the OAuth client; Monday's authorize/callback flow is independent of the Keycloak session)
