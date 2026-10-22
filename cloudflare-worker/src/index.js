export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    const target = new URL(env.ORIGIN);
    target.pathname = incoming.pathname;
    target.search = incoming.search;

    const headers = new Headers(request.headers);
    headers.set('host', target.host);
    headers.set('origin', 'http://127.0.0.1:9119');
    headers.set('x-forwarded-host', incoming.host);
    headers.set('x-forwarded-proto', incoming.protocol.replace(':', ''));

    const isUpgrade = (request.headers.get('upgrade') || '').toLowerCase() === 'websocket';
    const init = {
      method: request.method,
      headers,
      redirect: 'manual',
    };
    if (!isUpgrade && request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body;
    }

    const response = await fetch(target.toString(), init);
    if (isUpgrade || response.status === 101) {
      return response;
    }
    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete('content-encoding');
    responseHeaders.delete('content-length');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  },
};
