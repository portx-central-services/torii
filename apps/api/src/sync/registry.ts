import type { TrackerProvider } from '@torii/shared';
import type { TrackerAdapter } from '@torii/shared';

export type TrackerAdapterFactory = (config: {
  workspace: string;
  accessToken: string;
  refreshToken?: string;
  /** Harvest only — required for the `Harvest-Account-Id` header on every API call. */
  accountId?: string;
}) => TrackerAdapter;

const factories = new Map<TrackerProvider, TrackerAdapterFactory>();

export function registerAdapter(provider: TrackerProvider, factory: TrackerAdapterFactory): void {
  factories.set(provider, factory);
}

export function getAdapterFactory(provider: TrackerProvider): TrackerAdapterFactory {
  const factory = factories.get(provider);
  if (!factory) throw new Error(`No tracker adapter registered for provider "${provider}"`);
  return factory;
}

export function clearRegistry(): void {
  factories.clear();
}

export function listRegistered(): TrackerProvider[] {
  return Array.from(factories.keys());
}
