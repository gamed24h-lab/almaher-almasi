import publicWorker from './id-studio-public-index.js';
import mediaWorker from './id-studio-media-index.js';

export default {async fetch(request,env,ctx){const url=new URL(request.url);if(url.pathname==='/api/admin'&&request.method==='POST')return mediaWorker.fetch(request,env,ctx);if(url.pathname==='/api/id-studio/photo')return mediaWorker.fetch(request,env,ctx);return publicWorker.fetch(request,env,ctx)}};
