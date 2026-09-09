'use strict';
const fs = require('fs');
const p = 'D:/Casino/server.js';
let s = fs.readFileSync(p, 'utf8');
let ok = 0, fail = 0;
function rep(re, to, name) {
  if (re.test(s)) { s = s.replace(re, to); ok++; console.log('OK  ' + name); }
  else { fail++; console.log('MISS ' + name); }
}

// Replace the gzip middleware with an abort-safe version
rep(/\/\/ Gzip compression[\s\S]*?app\.use\(express\.json\(\)\);/,
"// Gzip compression - client.js/styles.css are large; cuts payload ~70-80%.\n" +
"app.use((req, res, next) => {\n" +
"  const accept = req.headers['accept-encoding'] || '';\n" +
"  if (!accept.includes('gzip')) return next();\n" +
"  const origWrite = res.write.bind(res);\n" +
"  const origEnd = res.end.bind(res);\n" +
"  let stream = null;\n" +
"  let done = false;\n" +
"  const cleanup = () => { done = true; };\n" +
"  res.on('close', () => { if (stream && !done) { cleanup(); try { stream.destroy(); } catch (e) {} } });\n" +
"  const tryGzip = () => {\n" +
"    if (stream || done || res.headersSent) return stream;\n" +
"    const ct = String(res.getHeader('Content-Type') || '');\n" +
"    if (res.getHeader('Content-Encoding')) return null;\n" +
"    if (!/text\\\\/|application\\\\/(json|javascript|xml)|image\\\\/svg/.test(ct)) return null;\n" +
"    res.setHeader('Content-Encoding', 'gzip');\n" +
"    res.removeHeader('Content-Length');\n" +
"    stream = require('zlib').createGzip();\n" +
"    stream.on('error', () => { cleanup(); try { origEnd(); } catch (e) {} });\n" +
"    stream.pipe(res);\n" +
"    return stream;\n" +
"  };\n" +
"  res.write = (chunk, enc, cb) => {\n" +
"    if (done) return false;\n" +
"    const g = tryGzip();\n" +
"    if (g) return g.write(chunk, enc, cb);\n" +
"    return origWrite(chunk, enc, cb);\n" +
"  };\n" +
"  res.end = (chunk, enc, cb) => {\n" +
"    if (done) return;\n" +
"    const g = tryGzip();\n" +
"    if (g) { cleanup(); return g.end(chunk, enc, cb); }\n" +
"    return origEnd(chunk, enc, cb);\n" +
"  };\n" +
"  next();\n" +
"});\n" +
"\n" +
"app.use(express.json());", 'gzip abort-safe');

fs.writeFileSync(p, s);
console.log('ok=' + ok + ' fail=' + fail);
