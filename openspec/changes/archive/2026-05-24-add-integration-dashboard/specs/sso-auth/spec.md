## ADDED Requirements

### Requirement: App is wrapped in an OIDC AuthProvider
The application SHALL be wrapped at its root layout in an OIDC AuthProvider that handles PKCE sign-in, redirect-callback code exchange, silent token renewal, and exposes auth state via a `useAuth()` hook to client components.

#### Scenario: AuthProvider initializes on first mount
- **WHEN** the application mounts
- **THEN** an `AuthProvider` SHALL be present at the root of the React tree (above all routes)
- **AND** it SHALL be configured with `authority`, `client_id`, and `redirect_uri` derived from environment variables

#### Scenario: Authority is derived from tenant and env
- **WHEN** the AuthProvider is configured
- **THEN** the OIDC authority URL SHALL be `https://auth.${NEXT_PUBLIC_PORTX_ENV}.piam.tenants.portx.io/realms/${NEXT_PUBLIC_PORTX_TENANT_ID}`
- **AND** the defaults when env vars are unset SHALL be `prod` for env and `preview` for tenant
- **AND** when env is `prod` the env segment SHALL be omitted from the authority host, yielding `https://auth.piam.tenants.portx.io/realms/preview`

#### Scenario: redirect_uri is the app origin
- **WHEN** the AuthProvider is configured
- **THEN** `redirect_uri` SHALL be `window.location.origin` (no dedicated callback route)
- **AND** the OIDC library SHALL strip `?code=` and `?state=` from the URL after a successful code exchange

### Requirement: Tokens are stored in sessionStorage
The OIDC user (including the access token) SHALL be persisted in `sessionStorage` so it survives page reloads in the same tab but is cleared when the tab closes.

#### Scenario: Token persists across tab reload
- **WHEN** a user signs in successfully and reloads the tab
- **THEN** the access token SHALL still be available via `useAuth()` without prompting another sign-in

#### Scenario: Token does not survive tab close
- **WHEN** a user signs in and then closes the browser tab
- **THEN** opening the application again in a new tab SHALL show the user as unauthenticated

### Requirement: useAuth exposes access token, user identity, and auth actions
A client-side `useAuth()` hook SHALL expose at minimum: the current access token (string or null), the OIDC user profile claims (name, email, preferred_username, sub), an `isAuthenticated` boolean, an `isLoading` boolean, a `signinRedirect()` function, and a `signoutRedirect()` function.

#### Scenario: Authenticated state surfaces token and user
- **WHEN** a user has completed sign-in
- **THEN** `useAuth()` SHALL return `isAuthenticated: true`, `isLoading: false`, the access token string, and a user object with at least `name`, `email`, and `sub`

#### Scenario: Unauthenticated state surfaces no token
- **WHEN** there is no signed-in user
- **THEN** `useAuth()` SHALL return `isAuthenticated: false` and the access token SHALL be `null`

#### Scenario: Loading state during code exchange
- **WHEN** the AuthProvider is exchanging an authorization code at the redirect URI
- **THEN** `useAuth()` SHALL return `isLoading: true` until the exchange resolves

### Requirement: RequireAuth wrapper guards authenticated routes
A `<RequireAuth>` client component SHALL wrap the authenticated portion of the app (`app/portal/**`). When the user is unauthenticated, RequireAuth SHALL save the current path, invoke `auth.signinRedirect()`, and render `<SigninShell state={{ kind: "signing-in" }} />` while waiting.

#### Scenario: Authenticated user passes through
- **WHEN** an authenticated user navigates to a route under `<RequireAuth>`
- **THEN** the wrapped children SHALL render normally

#### Scenario: Unauthenticated user is redirected to sign in
- **WHEN** an unauthenticated user navigates to a route under `<RequireAuth>`
- **THEN** `saveRedirectPath()` SHALL be invoked
- **AND** `auth.signinRedirect()` SHALL be invoked exactly once per mount
- **AND** the user SHALL be sent to the Keycloak sign-in page

#### Scenario: Loading state renders SigninShell
- **WHEN** `useAuth()` reports `isLoading: true` (e.g., during code exchange)
- **THEN** `<RequireAuth>` SHALL render `<SigninShell state={{ kind: "signing-in" }} />`
- **AND** SHALL NOT trigger another sign-in redirect

#### Scenario: Auth error with no user loaded renders SigninShell error
- **WHEN** `auth.error` is set AND `auth.user` is null
- **THEN** `<RequireAuth>` SHALL render `<SigninShell state={{ kind: "error", message: auth.error.message }} />`
- **AND** SHALL NOT invoke `signinRedirect` automatically

#### Scenario: Pending sign-out renders SigninShell signing-out
- **WHEN** `isSignoutPending()` returns `true` (the user just clicked Sign out and the round-trip has not yet completed)
- **THEN** `<RequireAuth>` SHALL render `<SigninShell state={{ kind: "signing-out" }} />`
- **AND** SHALL NOT invoke `signinRedirect` automatically (auto-signin is suppressed for the duration of the pending flag)

### Requirement: authedFetch helper attaches the bearer token
A shared `authedFetch(input, init?)` helper SHALL wrap the native `fetch` API to attach the current access token as an `Authorization: Bearer <token>` header on every request.

#### Scenario: Authorization header is added when authenticated
- **WHEN** a caller invokes `authedFetch(url)` while authenticated
- **THEN** the outgoing request SHALL include `Authorization: Bearer <accessToken>`

#### Scenario: Existing headers are preserved
- **WHEN** a caller invokes `authedFetch(url, { headers: { 'X-Foo': 'bar' } })`
- **THEN** the outgoing request SHALL include both `X-Foo: bar` and the `Authorization: Bearer …` header

#### Scenario: 401 response triggers re-authentication
- **WHEN** `authedFetch` receives an HTTP 401 response
- **THEN** it SHALL invoke `signinRedirect()` once
- **AND** the original `Response` SHALL still be returned to the caller so they can render an error state if desired

### Requirement: Sign out ends the OIDC session
Invoking sign-out from the user profile dropdown SHALL terminate the OIDC session at the IdP and return the user to the bare app origin. The OIDC library SHALL handle token revocation and user-store cleanup via `revokeTokensOnSignout: true`. Application code SHALL NOT manually iterate `sessionStorage` to remove `oidc.user:*` entries.

#### Scenario: User clicks Sign out
- **WHEN** an authenticated user clicks "Sign out" in the user profile dropdown
- **THEN** the click handler SHALL invoke `markSignoutPending()` (sets `sessionStorage["auth_signout_pending"] = "1"`) before calling `auth.signoutRedirect()`
- **AND** `signoutRedirect()` SHALL be called
- **AND** the OIDC session at the authority SHALL be ended
- **AND** the user SHALL land back at `${origin}` (the bare app origin), which re-enters the unauth flow
- **AND** the unauth surface SHALL render `<SigninShell signing-out>` while the pending flag is set
- **AND** once auth state stabilizes at the unauth branch, the surface SHALL clear the pending flag and invoke `auth.signinRedirect({ prompt: "login" })` so Keycloak displays its credential form (preventing silent re-auth via any surviving upstream SSO; see capability `auth-recovery`)

#### Scenario: Tokens are revoked by the library
- **WHEN** `signoutRedirect()` is invoked with `revokeTokensOnSignout: true` set on the AuthProvider
- **THEN** the library SHALL POST to the IdP's revocation endpoint for the access and refresh tokens
- **AND** the library SHALL clear its own user-store entry
- **AND** application code SHALL NOT additionally iterate `sessionStorage` keys to remove OIDC-prefixed entries

### Requirement: Configuration is sourced from public env vars
The OIDC authority, client id, tenant id, and API base URLs SHALL be derived from `NEXT_PUBLIC_*` environment variables that resolve at build time. The dead `postLogoutRedirectUri()` helper SHALL be removed (no callers). The dead `oidcRedirectUri()` env-var hatch SHALL also be removed (no callers; with `localhost:3000` on the realm's Valid Redirect URIs, `window.location.origin` always works without an override).

#### Scenario: Config module exposes derived URLs
- **WHEN** application code imports the auth config module
- **THEN** it SHALL receive at minimum: `tenantId`, `appEnv`, `oidcAuthority`, `oidcClientId`, `apiCatalogBaseUrl`
- **AND** it SHALL NOT export a `postLogoutRedirectUri()` helper (the value is `${origin}` at runtime, set inline in the AuthProvider config)
- **AND** it SHALL NOT export an `oidcRedirectUri()` helper or honor a `NEXT_PUBLIC_OIDC_REDIRECT_URI` env var; the AuthProvider SHALL set `redirect_uri: window.location.origin` directly

#### Scenario: Defaults apply when env vars are unset
- **WHEN** none of `NEXT_PUBLIC_PORTX_TENANT_ID`, `NEXT_PUBLIC_PORTX_ENV`, or `NEXT_PUBLIC_OIDC_CLIENT_ID` are set
- **THEN** the defaults SHALL be `preview`, `prod`, and `portal-ui` respectively
- **AND** the resulting authority SHALL be `https://auth.piam.tenants.portx.io/realms/preview` (prod-collapse removes the env segment)
- **AND** the resulting API Catalog base SHALL be the relative path `/api-catalog-proxy/api-catalog/1.0`

### Requirement: Local dev server runs on a port the realm allowlists
The dev script SHALL launch the Next.js dev server on a port included in the active realm's Valid Redirect URIs and Valid Post Logout Redirect URIs. The default-target `preview` realm (on the prod Keycloak instance) allowlists `http://localhost:3000` and `http://localhost:3000/*` in addition to other entries. `pnpm dev` SHALL therefore use Next.js's default port (`3000`) without an explicit `-p` flag. Devs targeting a different tenant or env via `.env.local` are responsible for ensuring that realm's `portal-ui` client also allowlists `http://localhost:3000`.

#### Scenario: pnpm dev binds to 3000 by default
- **WHEN** a developer runs `pnpm dev`
- **THEN** the Next.js dev server SHALL listen on port `3000` (the framework default) and `redirect_uri` SHALL evaluate to `http://localhost:3000`
- **AND** Keycloak SHALL accept the authorize request without an "Invalid parameter: redirect_uri" error

#### Scenario: package.json dev script is unpinned
- **WHEN** the `scripts.dev` entry of `package.json` is read
- **THEN** the value SHALL be `next dev --turbopack` (no `-p 5173`)

### Requirement: Browser-facing API Catalog calls go through a Next.js rewrites proxy
The browser SHALL call the API Catalog backend through a same-origin proxy path (`/api-catalog-proxy/...`) configured via Next.js `rewrites()` in `next.config.js`. The proxy SHALL forward to `https://api-catalog-backend.${env}.piam.tenants.portx.io` and SHALL pass headers (including `Authorization`) through unchanged. When env is `prod`, the env segment SHALL be omitted from the destination host.

#### Scenario: Browser request stays same-origin
- **WHEN** application code calls `authedFetch('/api-catalog-proxy/api-catalog/1.0/tenants/<tenant>/assets')`
- **THEN** the network request from the browser SHALL go to the application's own origin (e.g., `http://localhost:3000/api-catalog-proxy/...`)
- **AND** Next.js SHALL rewrite the request server-side to `https://api-catalog-backend.${env}.piam.tenants.portx.io/api-catalog/1.0/tenants/<tenant>/assets` (or `https://api-catalog-backend.piam.tenants.portx.io/...` when env is `prod`)

#### Scenario: Bearer token reaches the real backend
- **WHEN** the rewritten request is forwarded
- **THEN** the `Authorization: Bearer <token>` header SHALL be preserved on the upstream request

#### Scenario: Default env determines the proxy target
- **WHEN** `PORTX_ENV` is unset
- **THEN** the rewrite destination SHALL resolve to `https://api-catalog-backend.piam.tenants.portx.io/...` (env defaults to `prod`, which prod-collapses the env segment)

### Requirement: Only authenticated portal routes are guarded
The `<RequireAuth>` wrapper SHALL guard only routes under `/portal/**`. The `/api-docs` route SHALL remain publicly accessible without an OIDC session. The previously-public `/login` route no longer exists (Next.js renders 404).

#### Scenario: Unauthenticated user can reach /api-docs
- **WHEN** an unauthenticated user navigates to `/api-docs`
- **THEN** the API Consumer Portal SHALL render without redirecting away (it is intentionally public for consumer-facing docs)

#### Scenario: /login no longer exists
- **WHEN** any user navigates to `/login`
- **THEN** Next.js SHALL render its standard 404 page (the route was deleted with the fake-login removal; see capability `auth-page`)

### Requirement: AuthProvider config sets post_logout_redirect_uri to bare origin
The OIDC AuthProvider SHALL set `post_logout_redirect_uri: ${window.location.origin}` (no path suffix).

#### Scenario: Config sets bare-origin post-logout URI
- **WHEN** the AuthProvider initializes
- **THEN** `post_logout_redirect_uri` SHALL equal `window.location.origin` exactly
- **AND** SHALL NOT include `/login` or any other path

### Requirement: AuthProvider config enables silent renewal via static callback
The OIDC AuthProvider SHALL set `silent_redirect_uri: ${origin}/silent-callback.html`. A static `public/silent-callback.html` SHALL be present. The Keycloak realm's `Valid Redirect URIs` allowlist for the `portal-ui` client SHALL include the silent-callback URL.

#### Scenario: silent_redirect_uri is configured
- **WHEN** the AuthProvider initializes
- **THEN** the config SHALL include `silent_redirect_uri: ${window.location.origin}/silent-callback.html`

#### Scenario: Static silent-callback page exists
- **WHEN** the dev server or production build serves static assets
- **THEN** `silent-callback.html` SHALL be served at the app origin
- **AND** SHALL invoke the OIDC library's `signinSilentCallback()` helper

### Requirement: AuthProvider config enables token revocation on signout
The OIDC AuthProvider SHALL set `revokeTokensOnSignout: true`. Manual `oidc.user:*` storage cleanup helpers SHALL NOT exist in application code.

#### Scenario: revokeTokensOnSignout is set
- **WHEN** the AuthProvider initializes
- **THEN** the config SHALL include `revokeTokensOnSignout: true`

#### Scenario: Manual cleanup helper is absent
- **WHEN** application code is searched for iterations over `sessionStorage` looking for `oidc.user:` keys
- **THEN** no such iteration SHALL exist (the previous `clearOidcSessionStorage` helper in `app-sidebar.tsx` SHALL be removed)

### Requirement: Token-expired-at-mount attempts silent renewal first
When the AuthProvider's TokenSync detects an expired access token at mount, it SHALL attempt `auth.signinSilent()` once before falling back to `auth.signoutRedirect()`.

#### Scenario: Silent renewal succeeds for stale token
- **WHEN** TokenSync mounts and `auth.user.profile.exp` is in the past
- **AND** the refresh token (or IdP iframe session) is still valid
- **THEN** `auth.signinSilent()` SHALL resolve with a fresh user
- **AND** the lib's `addUserLoaded` handler SHALL propagate the new access token via `setAccessToken`
- **AND** the user SHALL NOT see a redirect

#### Scenario: Silent renewal fails for stale token
- **WHEN** TokenSync mounts and `auth.user.profile.exp` is in the past
- **AND** `auth.signinSilent()` rejects (e.g., refresh token revoked, IdP session expired)
- **THEN** TokenSync SHALL invoke `auth.signoutRedirect()`
- **AND** SHALL log the failure via `console.error` with prefix `[auth]`

### Requirement: Auth recovery is environment-uniform
The TokenSync recovery state machine SHALL behave identically on `localhost` and on deployed origins. There SHALL NOT be an `isLocalDev` or hostname-based branch that suppresses recovery actions.

#### Scenario: Localhost behaves like deployed
- **WHEN** an `auth.error` or `silentRenewError` occurs on `localhost`
- **THEN** the same recovery action SHALL fire as on a deployed origin
- **AND** the same `<SigninShell>` UI SHALL render
