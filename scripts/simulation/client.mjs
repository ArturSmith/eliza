import assert from 'node:assert/strict';
export class Client {
  cookies = new Map();
  constructor(url, origin, record = () => {}) {
    this.url = url;
    this.origin = origin;
    this.record = record;
  }
  async request(path, body, { method = body === undefined ? 'GET' : 'POST', status } = {}) {
    const response = await fetch(this.url + '/api' + path, {
      method,
      headers: {
        Origin: this.origin,
        'X-Eliza-Request': '1',
        'Content-Type': 'application/json',
        Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30000),
    });
    for (const value of response.headers.getSetCookie()) {
      const pair = value.split(';')[0];
      const at = pair.indexOf('=');
      const key = pair.slice(0, at),
        token = pair.slice(at + 1);
      if (token) this.cookies.set(key, token);
      else this.cookies.delete(key);
    }
    const data = await response.json();
    // Never record login bodies, passwords, cookies, or employee QR credentials.
    this.record({ type: 'http', method, path, status: response.status });
    assert.ok(
      status
        ? Array.isArray(status)
          ? status.includes(response.status)
          : response.status === status
        : response.ok,
      `${method} ${path}: HTTP ${response.status}: ${JSON.stringify(data)}`,
    );
    return data;
  }
}
