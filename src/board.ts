import { Session } from './session';
import { BoardConfig } from './board-config';
import { Post } from './post';
import { Environment } from './environment';
export class Board {
  constructor(private state: DurableObjectState, private env: Environment) {}

  private config: BoardConfig | undefined;
  private initializePromise: Promise<void> | undefined;
  private posts: Map<string, Post> = new Map<string, Post>();
  private sessions: Session[] = [];

  async initialize() {
    let config = await this.state.storage.get<BoardConfig>('config');
    let posts = await this.state.storage.list<Post>({ prefix: 'post.' });

    if (!config) {
      config = {
        id: this.state.id.toString(),
        title: this.state.id.name
      };
      await this.state.storage.put<BoardConfig>('config', config);
    }

    this.config = config;
    this.posts = posts;
  }

  async fetch(request: Request) {
    if (!this.initializePromise) {
      this.initializePromise = this.initialize().catch(err => {
        this.initializePromise = undefined;
        throw err;
      });
    }
    await this.initializePromise;

    let url = new URL(request.url);
    switch (url.pathname) {
      case '/ws':
        if (request.headers.get('Upgrade') !== 'websocket') {
          return new Response('expected websocket', { status: 400 });
        }
        let pair = new WebSocketPair();
        await this.handleSession(pair[1]);

        return new Response(null, { status: 101, webSocket: pair[0] } as any);

      case '/':
        const board = {
          posts: Array.from(this.posts?.values()),
          config: this.config
        };
        return new Response(JSON.stringify(board), {
          headers: { 'Content-Type': 'application/json' }
        });
      default:
        return new Response('Not found', { status: 404 });
    }
  }

  private handleSession = async (websocket: WebSocket) => {
    (websocket as any).accept();

    const session = new Session(websocket);

    this.sessions.push(session);

    session.sendMessage('newSession', {
      name: session.name,
      board: {
        posts: Array.from(this.posts?.values()),
        config: this.config,
        users: [this.sessions.map(_ => _.name)]
      }
    });

    const handlers = new Map<string, (payload: any) => Promise<void>>();

    handlers.set('post/addPost', async (post: Post) => {
      post.id = `${Date.now()}`;
      this.posts.set(`post.${post.id}`, post);
      await this.state.storage.put(`post.${post.id}`, post);
      this.broadcast('post/addPost', post);
    });
    handlers.set('post/updatePost', async (post: Post) => {
      this.posts.set(`post.${post.id}`, post);
      await this.state.storage.put(`post.${post.id}`, post);
      this.broadcastSkipSender(session, 'post/updatePost', post);
    });
    handlers.set('post/deletePost', async (postId: string) => {
      this.posts.delete(`post.${postId}`);
      await this.state.storage.delete(`post.${postId}`);
      this.broadcast('post/deletePost', postId);
    });
    handlers.set('config', async ({}) => {
      const board = {
        posts: Array.from(this.posts.values()),
        config: this.config,
        users: [this.sessions.map(_ => _.name)]
      };
      session.sendMessage('config', { board });
    });
    handlers.set('setName', async (data: { name: string }) => {
      let name: string = data.name;
      if (this.sessions.find(_ => _.name === name)) {
        session.sendError(`name ${name} already in use`);
      } else {
        const oldName = session.name;
        const newName = name;
        session.name = newName;
        this.broadcast('nameChanged', { oldName, newName });
      }
    });
    handlers.set('users', async (data: any) => {
      session.sendMessage('users', {
        users: [this.sessions.map(_ => _.name)]
      });
    });

    handlers.set('setOwner', async (data: { owner: string }) => {
      if (this.config?.owner) {
        session.sendError(`can only be owner when no owner exists`);
      } else {
        let oldOwner = this.config?.owner;
        let newOwner = data.owner;
        if (this.config) {
          this.config.owner = newOwner;
        }
        await this.state.storage.put('config', this.config);

        this.broadcast('ownerChanged', { oldOwner, newOwner });
      }
    });

    websocket.addEventListener('message', async msg => {
      try {
        if (session.quit) {
          websocket.close(1011, 'WebSocket broken.');
          return;
        }

        const data = JSON.parse(msg.data);
        if (handlers.has(data.type)) {
          const handler = handlers.get(data.type);
          if (handler) {
            await handler(data.payload);
          }
        }
      } catch (err) {
        session.sendError('an error occurred', err.stack);
      }
    });

    let closeOrErrorHandler = (evt: Event) => {
      session.quit = true;
      this.sessions = this.sessions.filter(member => member !== session);
      if (session.name) {
        this.broadcast('quit', { name: session.name });
      }
    };
    websocket.addEventListener('close', closeOrErrorHandler);
    websocket.addEventListener('error', closeOrErrorHandler);
  };

  private broadcastSkipSender(sender: Session, type: string, payload?: any) {
    // Iterate over all the sessions sending them messages.
    let quitters: Session[] = [];
    this.sessions = this.sessions.filter(session => {
      try {
        if (session !== sender) {
          session.sendMessage(type, payload);
        }
        return true;
      } catch (err) {
        // Whoops, this connection is dead. Remove it from the list and arrange to notify
        // everyone below.
        session.quit = true;
        quitters.push(session);
        return false;
      }
    });

    quitters.forEach(quitter => {
      this.broadcast('quit', { name: quitter.name });
    });
  }

  private broadcast(type: string, payload?: any) {
    // Iterate over all the sessions sending them messages.
    let quitters: Session[] = [];
    this.sessions = this.sessions.filter(session => {
      try {
        session.sendMessage(type, payload);
        return true;
      } catch (err) {
        // Whoops, this connection is dead. Remove it from the list and arrange to notify
        // everyone below.
        session.quit = true;
        quitters.push(session);
        return false;
      }
    });

    quitters.forEach(quitter => {
      this.broadcast('quit', { name: quitter.name });
    });
  }
}
