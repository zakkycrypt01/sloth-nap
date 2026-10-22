import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 3000);

const server = createServer(async (request, response) => {
  const url = request.url?.split("?")[0] ?? "/";
  if (url === "/api/brief") {
    try {
      const body = await readFile(path.join(root, "out", "morning-brief.json"));
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(body);
    } catch {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "No brief yet. Run npm run nap." }));
    }
    return;
  }
  const filePath = url === "/" ? path.join(root, "web", "index.html") : path.join(root, "web", path.basename(url));
  const stream = createReadStream(filePath);
  stream.on("error", () => {
    response.writeHead(404);
    response.end("Not found");
  });
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  stream.pipe(response);
});

server.listen(port, () => {
  const domain = process.env.TECH_DOMAIN;
  console.log(`Sloth Nap listening on ${domain ? `https://${domain}` : `http://localhost:${port}`}`);
});
