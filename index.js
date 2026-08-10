import * as health from './health.js';
import * as createBooking from './create-booking.js';
import * as getBooking from './get-booking.js';
import * as developerLogin from './developer-login.js';
import * as platformData from './platform-data.js';
import * as staffLogin from './staff-login.js';
import * as staffAdmin from './staff-admin.js';
import * as cloudCore from './cloud-core.js';
import * as systemRelease from './system-release.js';
const handlers = {
  'health': health.handler,
  'create-booking': createBooking.handler,
  'get-booking': getBooking.handler,
  'developer-login': developerLogin.handler,
  'platform-data': platformData.handler,
  'staff-login': staffLogin.handler,
  'staff-admin': staffAdmin.handler,
  'cloud-core': cloudCore.handler,
  'system-release': systemRelease.handler,
};

function toHeaderObject(headers) {
  const out = {};
  for (const [k, v] of headers.entries()) out[k.toLowerCase()] = v;
  return out;
}

async function toNetlifyEvent(request) {
  const url = new URL(request.url);
  const query = {};
  for (const [k, v] of url.searchParams.entries()) query[k] = v;
  let body = '';
  if (!['GET', 'HEAD'].includes(request.method)) body = await request.text();
  return {
    httpMethod: request.method,
    headers: toHeaderObject(request.headers),
    queryStringParameters: query,
    body,
    path: url.pathname,
    rawUrl: request.url,
  };
}

function fromNetlifyResponse(result = {}) {
  const status = Number(result.statusCode || 200);
  const headers = new Headers(result.headers || {});
  if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-store');
  return new Response(result.body ?? '', { status, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const prefix = '/.netlify/functions/';
    if (url.pathname.startsWith(prefix)) {
      const name = url.pathname.slice(prefix.length).replace(/\/+$/, '');
      const handler = handlers[name];
      if (!handler) {
        return new Response(JSON.stringify({ error: 'Function not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      }
      try {
        // With nodejs_compat and a modern compatibility date, Worker vars/secrets
        // are also exposed on process.env, so the original Netlify functions can
        // keep using SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY unchanged.
        const event = await toNetlifyEvent(request);
        const result = await handler(event, {});
        return fromNetlifyResponse(result);
      } catch (error) {
        console.error('Function adapter error', name, error);
        return new Response(JSON.stringify({ error: error?.message || 'Worker function failed' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
        });
      }
    }

    return env.ASSETS.fetch(request);
  },
};
