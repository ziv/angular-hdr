/// <reference lib="webworker" />

import { createProfileLoader } from '../io/profiles';
import { Pipeline } from './pipeline';
import type { PipelineRequest, RequestEnvelope, ResponseEnvelope } from './protocol';

class CancelledError extends Error {}

let pipeline: Pipeline | undefined;
const cancelled = new Set<number>();

const respond = (message: ResponseEnvelope, transfer: Transferable[] = []) =>
  postMessage(message, transfer);

/** Hands control back to the event loop so that a pending `cancel` message can be delivered. */
const yieldToEventLoop = () => new Promise((resolve) => setTimeout(resolve));

function ready(): Pipeline {
  if (!pipeline) throw new Error('The image worker was used before it was initialized');
  return pipeline;
}

async function handle(
  requestId: number,
  request: PipelineRequest,
): Promise<{ result: unknown; transfer?: Transferable[] }> {
  switch (request.type) {
    case 'init':
      pipeline = new Pipeline(createProfileLoader(request.baseUrl));
      return { result: undefined };
    case 'load':
      return { result: await ready().load(request.id, request.name, request.bytes) };
    case 'remove':
      return { result: ready().remove(request.id) };
    case 'render': {
      const result = await ready().render(request.source);
      // every render produces fresh buffers, so they can be handed over instead of copied
      return {
        result,
        transfer: [result.hdrPng.buffer, result.sdrPng.buffer, result.histogram.buffer],
      };
    }
    case 'inspect':
      return { result: ready().inspect(request.x, request.y) };
    case 'export': {
      try {
        const result = await ready().export(request.source, request.format, async (fraction) => {
          respond({ requestId, kind: 'progress', fraction });
          await yieldToEventLoop();
          if (cancelled.has(requestId)) throw new CancelledError('Export cancelled');
        });
        return { result, transfer: [result.bytes.buffer] };
      } finally {
        cancelled.delete(requestId);
      }
    }
    case 'cancel':
      cancelled.add(request.target);
      return { result: undefined };
  }
}

addEventListener(
  'message',
  async ({ data: { requestId, request } }: MessageEvent<RequestEnvelope>) => {
    try {
      const { result, transfer } = await handle(requestId, request);
      respond({ requestId, kind: 'result', result }, transfer);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      respond({ requestId, kind: 'error', message, cancelled: error instanceof CancelledError });
    }
  },
);
