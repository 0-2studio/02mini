declare module 'ws' {
  import { EventEmitter } from 'events';

  class WebSocket extends EventEmitter {
    static OPEN: number;
    static CONNECTING: number;
    static CLOSING: number;
    static CLOSED: number;

    readyState: number;

    constructor(url: string, options?: any);
    send(data: any): void;
    close(code?: number, reason?: string): void;
    terminate(): void;
    ping(): void;
    pong(): void;
  }

  namespace WebSocket {
    type Data = Buffer | string | ArrayBuffer | Buffer[];

    class Server extends EventEmitter {
      constructor(options?: any);
      close(callback?: (err?: Error) => void): void;
    }
  }

  export = WebSocket;
}
