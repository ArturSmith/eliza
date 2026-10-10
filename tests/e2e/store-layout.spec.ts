import { test, expect } from '@playwright/test';

test('manager builds, saves and reloads a store layout; stale and invalid saves are rejected', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('Store name', { exact: true }).fill('Layout shop');
  await page.getByLabel('Your name').fill('Owner');
  await page.getByLabel('Email address').fill('layout@example.test');
  await page.getByLabel('Password', { exact: true }).fill('local-test-password-123');
  await page.getByRole('button', { name: 'Create my store' }).click();
  await expect(page.getByRole('link', { name: 'Products', exact: true })).toBeVisible();
  await page.goto('/store-layout');
  await expect(page.getByRole('heading', { name: 'Store layout' })).toBeVisible();
  await page.getByRole('button', { name: /Island shelving/ }).click();
  await page.getByLabel('Position X (m)').fill('3');
  await page.getByLabel('Position X (m)').press('Tab');
  await page.getByLabel('Position Y (m)').fill('4');
  await page.getByLabel('Position Y (m)').press('Tab');
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  for (const name of [
    'Wall shelving',
    'Wall refrigerator',
    'Chest freezer',
    'Checkout counter',
    'Fruit and vegetables',
  ])
    await page
      .getByRole('button', { name: new RegExp(name) })
      .first()
      .click();
  await page.getByRole('button', { name: 'Save layout', exact: true }).click();
  await expect(page.getByText('Store layout saved.', { exact: true })).toBeVisible();
  const saved = await page.request.get('/api/store-layout').then((r) => r.json());
  expect(saved.layout.objects).toHaveLength(7);
  expect(saved.layout.objects[0].x).toBe(3);
  expect(saved.layout.objects[0].y).toBe(4);
  const headers = { Origin: 'http://localhost:5174', 'X-Eliza-Request': '1' };
  const stale = await page.request.post('/api/store-layout', {
    headers,
    data: { ...saved, version: 0 },
  });
  expect(stale.status()).toBe(409);
  const invalid = await page.request.post('/api/store-layout', {
    headers,
    data: { ...saved, layout: { ...saved.layout, width: 2 } },
  });
  expect(invalid.status()).toBe(400);
  await page.reload();
  await expect(page.getByLabel('Store width (m)')).toHaveValue('12');
  await expect(page.locator('.store-layout-object-list button')).toHaveCount(7);
  await page.screenshot({ path: '/private/tmp/eliza-store-layout-3d.png', fullPage: true });
  await page.getByRole('button', { name: 'Floor plan', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Interactive store layout' })).toBeVisible();
  await page.screenshot({ path: '/private/tmp/eliza-store-layout-top.png', fullPage: true });
  await page.locator('.store-layout-scene').scrollIntoViewIfNeeded();
  const points = await page.locator('.store-layout-scene').evaluate((svg: SVGSVGElement) => {
    const toScreen = (x: number, y: number) => {
      const p = svg.createSVGPoint();
      p.x = x;
      p.y = y;
      const q = p.matrixTransform(svg.getScreenCTM()!);
      return { x: q.x, y: q.y };
    };
    return { start: toScreen(-1.5, -3.5), end: toScreen(-0.5, -2.5) };
  });
  await page.mouse.move(points.start.x, points.start.y);
  await page.mouse.down();
  await page.mouse.move(points.end.x, points.end.y, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByLabel('Position X (m)')).toHaveValue('4');
  await expect(page.getByLabel('Position Y (m)')).toHaveValue('5');
  await page.getByRole('button', { name: 'Rotate 90°' }).click();
  await expect(page.getByText('Rotation: 90°')).toBeVisible();
  await page.getByRole('button', { name: 'Save layout', exact: true }).click();
  await expect(page.getByText('Store layout saved.', { exact: true })).toBeVisible();
});
