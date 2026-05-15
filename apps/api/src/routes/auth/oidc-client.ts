import { Issuer, type Client } from 'openid-client';

export interface OidcProviderConfig {
  name: 'google' | 'okta';
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

const cache = new Map<string, Promise<Client>>();

export function getOidcClient(config: OidcProviderConfig): Promise<Client> {
  const cacheKey = `${config.name}:${config.clientId}`;
  let entry = cache.get(cacheKey);
  if (!entry) {
    entry = (async () => {
      const issuer = await Issuer.discover(config.issuerUrl);
      return new issuer.Client({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uris: [config.redirectUri],
        response_types: ['code'],
      });
    })();
    cache.set(cacheKey, entry);
  }
  return entry;
}

export function clearOidcClientCache(): void {
  cache.clear();
}
