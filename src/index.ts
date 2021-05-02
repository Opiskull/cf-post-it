import { Environment } from './environment';

export { Board } from './board';

// In order for the workers runtime to find the class that implements
// our Durable Object namespace, we must export it from the root module.

export default {
  async fetch(request: Request, env: Environment) {
    try {
      return await handleRequest(request, env);
    } catch (e) {
      return new Response(e.message);
    }
  }
};

async function handleRequest(request: Request, env: Environment) {
  const url = new URL(request.url);

  const [_, boardId, route] = url.pathname.split('/');

  if (!boardId) {
    return new Response('No Board found', { status: 404 });
  }

  let id = env.BOARD.idFromName(boardId);
  let obj = env.BOARD.get(id);

  const newUrl = new URL(request.url);
  newUrl.pathname = '/ws';
  let resp = await obj.fetch(newUrl.pathname, request);
  return resp;
}

declare global {
  var WebSocketPair: {
    new (): {
      0: WebSocket;
      1: WebSocket;
    };
  };
}
