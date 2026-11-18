import { bus } from "../lib/bus.js";

// SSE：把看板、票、執行的變動即時推給前端
export function stream(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.write(": connected\n\n");
  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  const ping = setInterval(() => res.write(": ping\n\n"), 20000);
  bus.on("event", send);
  req.on("close", () => {
    clearInterval(ping);
    bus.off("event", send);
  });
}
