import type { CloudProviderType, ProvisionResult, VpsProviderDriver, VpsSpecs } from './types.js';
import { DaytonaDriver } from './daytonaDriver.js';
import { FreestyleDriver } from './freestyleDriver.js';

export type { CloudProviderType, ProvisionResult, VpsProviderDriver, VpsSpecs };
export { DaytonaDriver } from './daytonaDriver.js';
export { FreestyleDriver } from './freestyleDriver.js';

export class VpsProviderFactory {
  private static drivers: Map<string, VpsProviderDriver> = new Map();

  static getDriver(provider: CloudProviderType = 'daytona'): VpsProviderDriver {
    const key = provider === 'freestyle' ? 'freestyle' : 'daytona';
    if (!this.drivers.has(key)) {
      if (key === 'freestyle') {
        this.drivers.set(key, new FreestyleDriver());
      } else {
        this.drivers.set(key, new DaytonaDriver());
      }
    }
    return this.drivers.get(key)!;
  }
}

export function getVpsProviderDriver(provider: CloudProviderType = 'daytona'): VpsProviderDriver {
  return VpsProviderFactory.getDriver(provider);
}
