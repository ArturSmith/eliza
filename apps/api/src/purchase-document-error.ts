import { HttpException } from '@nestjs/common';
import type { DocumentErrorDetails } from '@eliza/contracts';

/** Only structured diagnostics leave the server; provider prose can contain keys or document text. */
export class PurchaseDocumentError extends HttpException {
  constructor(
    message: string,
    public readonly details: DocumentErrorDetails,
  ) {
    super(message, 503);
  }
}
export function safeProviderCode(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(value) ? value : undefined;
}
export function safeProviderRequestId(value: string | null): string | undefined {
  return value && /^req_[a-zA-Z0-9_-]{1,100}$/.test(value) ? value : undefined;
}
export function providerFailure(status: number, code: unknown, requestId?: string) {
  const providerCode = safeProviderCode(code);
  let message =
    'OpenAI rejected the document request. Check the technical details and server configuration.';
  if (
    [
      'insufficient_quota',
      'credit_balance_exhausted',
      'billing_hard_limit_reached',
      'billing_not_active',
    ].includes(providerCode ?? '')
  )
    message =
      'OpenAI API credits or spending quota are exhausted. Check API billing and usage limits, then try again.';
  else if (status === 401 || providerCode === 'invalid_api_key')
    message =
      'OpenAI rejected the API key. Check OPENAI_API_KEY on the server and restart the service.';
  else if (status === 403)
    message = 'OpenAI denied access. Check the API project permissions and account access.';
  else if (status === 404 || providerCode === 'model_not_found')
    message =
      'The configured OpenAI model is unavailable to this API project. Check OPENAI_MODEL and model access.';
  else if (status === 429) message = 'OpenAI rate limit reached. Wait briefly and try again.';
  else if (status >= 500) message = 'OpenAI is temporarily unavailable. Try again later.';
  else if (status === 400 || status === 422)
    message =
      'OpenAI rejected the request settings or uploaded file. Check the model configuration and file, then try again.';
  return new PurchaseDocumentError(message, { providerStatus: status, providerCode, requestId });
}
