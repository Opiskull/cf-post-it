export class Session {
  public quit: boolean = false;
  public name: string = 'Anonymous.' + Date.now();

  constructor(private webSocket: WebSocket) {}

  public sendMessage(message: any): void {
    const jsonMessage =
      typeof message !== 'string' ? JSON.stringify(message) : message;

    this.webSocket.send(jsonMessage);
  }

  public sendError(message: string, stacktrace?: string) {
    this.sendMessage({ type: 'error', message: message, stack: stacktrace });
  }
}
