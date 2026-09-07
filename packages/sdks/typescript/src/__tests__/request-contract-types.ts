import { SupaOAuthClient, type RequestContract } from '../index.js';

declare const client: SupaOAuthClient;
declare const contract: RequestContract<{ name: string }, { version: number }>;
const result: Promise<{ version: number }> = client.execute(contract, { name: 'item' });
// @ts-expect-error The request cannot widen the contract input.
client.execute(contract, { name: 1 });
// @ts-expect-error The result comes from the decoder.
const wrong: Promise<{ id: string }> = client.execute(contract, { name: 'item' });
void result;
void wrong;
