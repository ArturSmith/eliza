import { describe, expect, it, vi } from 'vitest';
import { executeAiTool, availableAiTools } from '../apps/api/src/ai-tools';
import type { Database } from '../apps/api/src/database';
import type { AuthRequest } from '../apps/api/src/security';
function fixture(permissions: string[] = ['sales.read', 'purchases.read']) {
  const query = vi.fn(async () => ({ rows: [] }));
  const database = {
    pool: { connect: async () => ({ query, release: vi.fn() }) },
  } as unknown as Database;
  const req = {
    context: {
      store: {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        timezone: 'Europe/Oslo',
        currency: 'NOK',
      },
      user: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', permissions },
    },
  } as unknown as AuthRequest;
  return { database, req, query };
}
describe('AI read tool boundaries', () => {
  it('exposes only tools permitted to the signed-in employee', () => {
    expect(availableAiTools(['sales.read']).map((t) => t.name)).toEqual([
      'sales_summary',
      'sales_breakdown',
    ]);
    expect(availableAiTools(['costs.read']).some((t) => t.name === 'gross_profit')).toBe(false);
    expect(
      availableAiTools(['costs.read', 'sales.read']).some((t) => t.name === 'gross_profit'),
    ).toBe(true);
  });
  it('rejects a purchase tool without purchase permission before querying', async () => {
    const { database, req, query } = fixture(['sales.read']);
    await expect(
      executeAiTool(database, req, 'search_purchases', { query: 'ABC' }),
    ).rejects.toMatchObject({ status: 403 });
    expect(query).not.toHaveBeenCalled();
  });
  it('validates arguments and never accepts a model-supplied store ID', async () => {
    const { database, req, query } = fixture();
    expect(
      await executeAiTool(database, req, 'search_purchases', { query: 'ABC', storeId: 'other' }),
    ).toEqual({ error: 'Invalid tool arguments.' });
    expect(query).not.toHaveBeenCalled();
    await executeAiTool(database, req, 'search_purchases', { query: 'ABC' });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('p.store_id=$1'), [
      req.context.store.id,
      '%ABC%',
    ]);
  });
  it('looks up scanned documents only inside the authenticated store', async () => {
    const { database, req, query } = fixture();
    const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    expect(await executeAiTool(database, req, 'document_details', { id })).toEqual({
      notFound: true,
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('store_id=$1 AND id=$2'), [
      req.context.store.id,
      id,
    ]);
  });
});
