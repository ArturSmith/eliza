# Purchase document assistant

Implemented: 19 September 2026.

## Enable on the server

Set `OPENAI_API_KEY` in the **backend service's runtime environment**, then redeploy/restart that service with this code. The key never belongs in frontend variables (especially `VITE_*`), source control, or browser storage. Local development can use the repository-root `.env`, which the backend already loads.

`OPENAI_MODEL` is optional; the default remains `gpt-4o-mini`. A replacement must support image inputs and strict structured outputs with the existing Chat Completions request parameters. A missing key or unavailable provider returns a translated error; manual purchase entry remains available.

## Shop workflow

1. Open **Purchases → New purchase order**, or edit a draft.
2. Choose the supplier and select **Read supplier document**.
3. Upload one JPEG, PNG, or WebP image, at most 4.4 MB.
4. Select **Read document**. The image is sent to OpenAI, and extracted rows are added directly to the purchase table. Existing filled rows are preserved.
5. Expand **Open original image** in the purchase form to compare the suggestions with the document.
6. Edit products, quantities, unit costs, proposed selling prices and tax directly in the table. Unmatched items remain visible until you select or create their catalogue product.
7. Quantities and costs must use the product's stock unit. Convert cartons yourself and enter the tax rate from the document.
8. Resolve duplicates; rows with different costs remain visible. Remove unwanted rows or add items manually.
9. Review the calculated line totals, subtotal, tax and overall total. Incomplete rows show a dash instead of a misleading total.
10. Confirm the document review and select **Save draft**. Editing a row clears the confirmation. Ordering, receiving and payment recording remain separate actions.

New and existing drafts use the same editable table, with horizontal scrolling on smaller screens. Scanned descriptions and codes stay beside each product during the editing session. Draft saving rejects unresolved products, duplicate products and fractional quantities for whole-unit products. An existing supplier reference is retained when another image is read.

## Scope and limits

- This is a guided document-to-draft assistant, not an unrestricted conversational chatbot.
- One image per reading; no PDF or multi-page import yet.
- Maximum 100 document rows and 100 distinct products in a draft.
- Tax, shipping, discounts, currency conversion, pack conversion and invoice-total reconciliation are not automatically extracted.
- The document date is shown for reference; it does not set the expected delivery date.
- Supplier selection and new-product creation stay under user control.
- No duplicate-invoice detection yet: check the supplier reference against existing purchases before saving.
- Eliza does not persist document images or chat history. Closing the purchase form discards unsaved review state.
- Provider calls are limited to six per store per minute, time out after 60 seconds, and have bounded response size.
- Refusals, incomplete responses, malformed output and oversized line lists are rejected, never silently imported as partial documents.
- Requests require `purchases.write` and a supplier belonging to the current store. Only the image and transcription instructions are sent to OpenAI; catalogue matching stays on the server.

## Validation

Unit tests cover decimal merging, conflicting identifiers and different-cost duplicates. Integration tests use an isolated database and mocked provider responses. Browser coverage exercises invalid uploads, provider retry, matching corrections, tax entry, whole-unit validation and explicit draft saving without stock or selling-price changes.

A live provider smoke test still needs to run on the configured server: use a synthetic invoice with a known supplier article code, confirm the review opens, and verify extracted fields before saving. No real OpenAI request was made during local verification because the key is configured only on the deployed server.

## Troubleshooting document reading

Failures now identify API authentication, credits/quota, permissions, model access, rate limits, provider downtime, network failures, timeouts, refusals and invalid/incomplete responses. Expand **Technical details** to see the provider HTTP status, error code and OpenAI request ID when available. These identifiers can help investigate a failed request.

Provider authentication errors do not sign the Eliza user out: the app returns a service error while retaining the actual provider status in diagnostics. Raw provider prose, API keys and document content are not forwarded. English and Russian messages are available. Deploy this version before retrying to see the new diagnostics; it cannot recover details from earlier failed requests.
