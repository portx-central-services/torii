import { Issuer, type Client } from 'openid-client';

/** Connection settings for Torii's confidential Keycloak client. */
export interface KeycloakConfig {
  /** Full realm URL, e.g. https://auth.preview.piam.tenants.portx.io/realms/preview */
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

let cached: Promise<Client> | null = null;
let cachedKey = '';

/**
 * Discover the Keycloak realm metadata and return a typed OIDC client. The
 * discovery doc is cached per (issuer, clientId) pair for the process lifetime.
 */
export function getKeycloakClient(config: KeycloakConfig): Promise<Client> {
  const key = `${config.issuerUrl}|${config.clientId}`;
  if (!cached || cachedKey !== key) {
    cachedKey = key;
    cached = (async () => {
      const issuer = await Issuer.discover(config.issuerUrl);
      return new issuer.Client({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uris: [config.redirectUri],
        response_types: ['code'],
      });
    })();
  }
  return cached;
}

export function clearKeycloakClientCache(): void {
  cached = null;
  cachedKey = '';
}
