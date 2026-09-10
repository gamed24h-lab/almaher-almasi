import publicWorker from './id-studio-public-index.js';
import opsWorker from './id-studio-ops-index.js';

export default {async fetch(request,env,ctx){const url=new URL(request.url);if(url.pathname==='/api/admin'&&request.method==='POST')return opsWorker.fetch(request,env,ctx);if(url.pathname==='/api/id-studio/photo')return opsWorker.fetch(request,env,ctx);return publicWorker.fetch(request,env,ctx)}};
