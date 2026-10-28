import type { Context } from '@deepseek-ai/cordis';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { SessionId } from '@deepseek-ai/dsh-session';
import type {} from '@deepseek-ai/dsh-typert-registry';
import { RETRY_REMOTE } from './retry-remote.ts';
import { RetryRequestSchema, type RetryRequest, type RetryResponse } from './contract.ts';

export class RetryService extends TypertRemoteService {
  constructor(ctx: Context, private readonly retryReport: (request: RetryRequest) => Promise<RetryResponse>) {
    super(ctx, 'modelSpokesperson');
    ctx.inject(['typert'], child => {
      child.effect(() => child.typert.register({ package: RETRY_REMOTE.package, face: 'host', schemas: [], model: { services: [], events: [], objects: [] }, invocations: RETRY_REMOTE.descriptors }));
    });
  }
  @Remote({ resources: { session: (request: RetryRequest) => SessionId(request.sessionId) } })
  async retry(request: RetryRequest): Promise<RetryResponse> {
    return this.retryReport(RetryRequestSchema.parse(request));
  }
}
declare module '@deepseek-ai/cordis' { interface Context { modelSpokesperson: RetryService } }
