# Purchase document assistant

Implemented: 19 September 2026.

## Enable on the server

Set `OPENAI_API_KEY` in the **backend service's runtime environment**, then redeploy/restart that service with this code. The key never belongs in frontend variables (especially `VITE_*`), source control, or browser storage. Local development can use the repository-root `.env`, which the backend already loads.

`OPENAI_MODEL` is optional; the default remains `gpt-4o-mini`. A replacement must support image inputs and strict structured outputs with the existing Chat Completions request parameters. A missing key or unavailable provider returns a translated error; manual purchase entry remains available.

## Shop workflow

1. Open **Purchases → New purchase order**, or edit a draft.
2. Choose the supplier and select **Read supplier document**.
3. Upload one JPEG, PNG, or WebP image, at most 4.4 MB.
4. Select **Read document**. The image is sent to OpenAI only at this step.
5. Expand **Open original image** to compare the suggestions with the document.
6. Review every product, quantity and unit cost. Supplier article codes, barcodes and internal SKUs are matched against active records in this store. Conflicting or missing matches require manual selection.
7. Enter the tax rate for each row. Convert carton quantities and costs into the product's stock unit yourself; Eliza does not infer pack conversions or tax.
8. Correct duplicates before continuing. Same-product, same-cost rows may be combined using exact decimal quantities. Different-cost rows remain separate until a person resolves them.
9. Confirm the review and select **Add reviewed lines to draft**. This appends to existing selected products; an existing supplier reference is retained.
10. Check the normal purchase form and select **Save draft**. Ordering, receiving, price changes and payment recording still use their existing explicit actions.

To create an unknown product, close the review, use **Create new product** in the purchase form, and reopen the review. The review remains in memory while the purchase form stays mounted and the supplier stays unchanged. Changing supplier clears it to prevent importing another supplier's suggestions.

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
