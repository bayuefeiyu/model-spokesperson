import { z } from 'zod';
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import { RetryRequestSchema, RetryResponseSchema, type RetryRequest, type RetryResponse } from './contract.ts';

// One shared, typed protocol definition for the independently distributed plugin.
// The Host registry and Client mount consume the same strict descriptors/codecs.
const request = { mode: 'strict' as const, typeSymbol: '@dsh-plugins/model-spokesperson#RetryRequest', create: () => RetryRequestSchema };
export const RETRY_REMOTE = createTypertRemoteInfo({ package: '@dsh-plugins/model-spokesperson-host', methods: {
  'modelSpokesperson/retry': {
    service: 'modelSpokesperson', invocation: { kind: 'direct' },
    parameters: [{ name: 'request', source: 'json', codec: request, strictCodec: request }],
    result: { mode: 'strict', typeSymbol: '@dsh-plugins/model-spokesperson#RetryResponse', create: () => RetryResponseSchema },
  },
} }, z);

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap { 'modelSpokesperson/retry': (request: RetryRequest) => Promise<RemoteResult<RetryResponse>> }
  interface TypertRemoteNamespaceMap { modelSpokesperson: { retry(request: RetryRequest): Promise<RemoteResult<RetryResponse>> } }
}
