import net from "node:net";
import { RpcReply } from "./protocol";
export class GuardClient {
  constructor(readonly name: string) {}
  request<T>(method: string, args: unknown = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection("\\\\.\\pipe\\" + this.name);
      let buffer = "";
      let replied = false;
      socket.setTimeout(5000);
      socket.once("connect", () => socket.write(JSON.stringify({ method, args }) + "\n"));
      socket.on("data", chunk => {
        buffer += chunk.toString("utf8");
        if (buffer.length > 1024 * 1024) { socket.destroy(new Error("Oversized guard response")); return; }
        const end = buffer.indexOf("\n");
        if (end < 0) return;
        replied = true;
        socket.end();
        try {
          const reply = JSON.parse(buffer.slice(0, end)) as RpcReply<T>;
          if (!reply.ok) reject(new Error(reply.error ?? "Guard rejected request"));
          else resolve(reply.data as T);
        } catch (error) { reject(error); }
      });
      socket.once("timeout", () => socket.destroy(new Error("관리 서비스 응답 시간 초과")));
      socket.once("error", reject);
      socket.once("close", () => { if (!replied) reject(new Error("관리 서비스 연결이 종료되었습니다.")); });
    });
  }
}
