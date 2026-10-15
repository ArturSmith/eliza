# Eliza AI

Open **Eliza AI** (`/ai`) from the sidebar after signing in. Ask about sales, stock, products, purchases, suppliers, or scanned documents. Use **New conversation** for a fresh topic; earlier conversations are saved per employee and store and can be reopened from the history panel. The chat accepts JPEG, PNG, WebP, and PDF documents up to 8 MB using the existing scanning pipeline, or a previously saved scan. After attaching a scan, its extracted content is available to the conversation and a link to the original remains in the message.

## Setup

Run `pnpm build` and `pnpm db:migrate`. Set `OPENAI_API_KEY` in the backend runtime or repository-root `.env`, then restart the API. `OPENAI_AGENT_MODEL` is optional; it falls back to `OPENAI_MODEL` and then `gpt-4o-mini`. The model must support the OpenAI Responses API and function calling. Keep the key out of browser variables and source control. OpenAI calls are made only from the API server. Requests use `store: false` and contain the current question, a bounded conversation history or summary, relevant authorized tool results, and any scanned document the user attached. This data is sent to OpenAI for processing.

## Data and permissions

The agent has only read tools: sales summaries and breakdowns; gross profit for roles with sales and cost permissions; catalog search; inventory and low stock; purchase search and details; supplier purchase totals; scanned document search and details. Each tool validates its arguments, checks the employee's current role permissions, uses bounded results and store-scoped queries; custom lookup queries run in read-only transactions with an eight-second database statement timeout, and binds the store ID from the authenticated server session. The model cannot choose a user or store ID, issue SQL, or invoke write actions. Conversations are private to the authenticated employee and store. The API limits messages to 12 per employee per minute and limits each model turn to five response rounds and eight tool calls. Provider failures leave the current message unsaved so the user can retry.

`0022_ai_agent.sql` stores conversations and messages in PostgreSQL. Recent turns are sent to the model; when the unsummarized history exceeds 20 messages, the server creates a bounded summary and keeps the newest 12 messages. An uploaded scan appears as an editable digital draft in the chat. Saving it promotes it to a searchable digital document; neither a draft nor a saved digital document becomes a purchase order or inventory movement. The original document stays available at `/ai?document=<id>` under the normal document permission check.

The agent currently has no write tools. Updating stock, products, and purchases still uses the existing forms and audit rules. Digital-document edits use the editor embedded in chat and require purchasing write permission. Chat answers stream into the UI as text arrives; the UI shows a thinking state before the first text chunk. The exchange is saved only when the model finishes successfully.

## Verification

Run `pnpm test` for unit tests, `pnpm exec vitest run --config vitest.integration.config.ts tests/ai-agent.integration.test.ts` for the isolated database and mocked provider checks, and `pnpm exec playwright test tests/e2e/ai-agent.spec.ts` for the chat UI. The integration checks authentication, current store and employee isolation, follow-up context, tool output handling, scanned document references, empty results, invalid arguments, provider failures and absence of write tools. For a live smoke test, ask for a known sales period and compare the answer with **Sales**, then find a saved invoice by number and compare it with the original scan.

## Replenishment read tool — 15 October 2026

Slow/no-sales and order-quantity/timing questions can use `replenishment`, backed by
the same service as the Replenishment page. It requires sales, inventory, purchasing
and supplier read permissions. Results include the completed local date window,
observed product history, gross units sold, refunds separately, current batch stock,
expiry allowances, dated incoming orders, pack rounding, order-by date and warnings.
Insufficient history or missing supply facts must not become invented quantities.
The report is a planning estimate, not a seasonality or lost-demand forecast. It
creates no purchase orders and sends no notifications.
