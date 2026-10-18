// Stop accepting connections, discard idle Chromium preconnect sockets, and let
// active requests finish before Nest closes the database pool or backups run.
export function trackHttpShutdown(server) {
  const sockets = new Map();
  let closing = false;
  server.on('connection', (socket) => {
    sockets.set(socket, 0);
    socket.once('close', () => sockets.delete(socket));
  });
  server.prependListener('request', (request, response) => {
    const socket = request.socket;
    sockets.set(socket, (sockets.get(socket) ?? 0) + 1);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (!sockets.has(socket)) return;
      const pending = Math.max(0, sockets.get(socket) - 1);
      sockets.set(socket, pending);
      if (closing && pending === 0) socket.end();
    };
    response.once('finish', finish);
    response.once('close', finish);
  });
  return async () => {
    closing = true;
    const closed = new Promise((done, reject) =>
      server.close((error) => {
        if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
        else done();
      }),
    );
    for (const [socket, pending] of sockets) if (pending === 0) socket.destroy();
    await closed;
  };
}
