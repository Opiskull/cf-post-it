export class Session {
  public quit: boolean = false;
  public name: string = 'Anonymous.' + Date.now();

  constructor(private webSocket: WebSocket) {}

  public sendMessage(type: string, payload: any) {
    this.webSocket.send(JSON.stringify({ type, payload }));
  }

  public sendError(message: string, stacktrace?: string) {
    this.sendMessage('error', { message: message, stack: stacktrace });
  }
}
