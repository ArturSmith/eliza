import { afterEach, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { connect } from 'node:net';
import { once } from 'node:events';
import { trackHttpShutdown } from '../apps/desktop/src/http-shutdown.mjs';
const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    server.close();
  }
});
async function listen(server: Server) {
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return (server.address() as { port: number }).port;
}
it('closes idle preconnect sockets that have never sent an HTTP request', async () => {
  const server = createServer();
  const stop = trackHttpShutdown(server);
  const port = await listen(server);
  const accepted = once(server, 'connection');
  const socket = connect(port, '127.0.0.1');
  socket.on('error', () => {});
  await accepted;
  const disconnected = once(socket, 'close');
  await stop();
  await disconnected;
  expect(server.listening).toBe(false);
});
it('waits for an active operation and delivers its response before closing', async () => {
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  const entered = new Promise<void>((done) => {
    started = done;
  });
  const server = createServer((_request, response) => {
    started();
    void gate.then(() => response.end('sale committed'));
  });
  const stop = trackHttpShutdown(server);
  const port = await listen(server);
  const response = fetch(`http://127.0.0.1:${port}`).then((r) => r.text());
  await entered;
  let stopped = false;
  const closing = stop().then(() => {
    stopped = true;
  });
  await new Promise((done) => setImmediate(done));
  expect(stopped).toBe(false);
  release();
  expect(await response).toBe('sale committed');
  await closing;
  expect(stopped).toBe(true);
});
