"use strict";
// Serve the exact desktop renderer for browser development. No build step.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const port =
  Number(args[args.indexOf("--port") + 1]) || Number(process.env.PORT) || 4173;
const root = path.resolve(__dirname, "..");
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
};
http
  .createServer((req, res) => {
    let filename;
    try {
      const url = new URL(req.url, "http://localhost");
      filename = path.resolve(
        root,
        "." +
          decodeURIComponent(
            url.pathname === "/" ? "/src/index.html" : url.pathname,
          ),
      );
      // The root page has relative assets in src/.
      if (!fs.existsSync(filename) && !url.pathname.slice(1).includes("/"))
        filename = path.resolve(root, "src", "." + url.pathname);
      if (
        !filename.startsWith(root + path.sep) ||
        !fs.statSync(filename).isFile()
      )
        throw new Error();
    } catch {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type":
        types[path.extname(filename)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    fs.createReadStream(filename).pipe(res);
  })
  .listen(port, "0.0.0.0", () => console.log(`Newon preview on port ${port}`));
