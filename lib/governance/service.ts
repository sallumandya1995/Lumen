export * from './store-core';
import {createFastApiService} from './store-core';
import {createHostedService} from './hosted-client';
const env=(import.meta as any).env;
export const governanceService=env?.VITE_API_BASE_URL?createFastApiService(env.VITE_API_BASE_URL):createHostedService();
