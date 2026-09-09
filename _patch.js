'use strict';
const fs = require('fs');
const p = 'D:/Casino/server.js';
let s = fs.readFileSync(p, 'utf8');
let ok = 0, fail = 0;
function rep(re, to, name) {
  if (re.test(s)) { s = s.replace(re, to); ok++; console.log('OK  ' + name); }
  else { fail++; console.log('MISS ' + name); }
}

// ---- 1. Gzip compression for all responses ----
rep(/app\.use\(express\.json\(\)\);/,
"// Gzip compression — client.js/styles.css are large; cuts payload ~70-80%.\n" +
"app.use((req, res, next) => {\n" +
"  const accept = req.headers['accept-encoding'] || '';\n" +
"  if (!accept.includes('gzip')) return next();\n" +
"  const origWrite = res.write.bind(res);\n" +
"  const origEnd = res.end.bind(res);\n" +
"  let stream = null;\n" +
"  const tryGzip = () => {\n" +
"    if (stream || res.headersSent) return stream;\n" +
"    const ct = String(res.getHeader('Content-Type') || '');\n" +
"    if (res.getHeader('Content-Encoding')) return null;\n" +
"    if (!/text\\/|application\\/(json|javascript|xml)|image\\/svg/.test(ct)) return null;\n" +
"    res.setHeader('Content-Encoding', 'gzip');\n" +
"    res.removeHeader('Content-Length');\n" +
"    stream = require('zlib').createGzip();\n" +
"    stream.pipe(res);\n" +
"    return stream;\n" +
"  };\n" +
"  res.write = (chunk, enc, cb) => {\n" +
"    const g = tryGzip();\n" +
"    if (g) return g.write(chunk, enc, cb);\n" +
"    return origWrite(chunk, enc, cb);\n" +
"  };\n" +
"  res.end = (chunk, enc, cb) => {\n" +
"    const g = tryGzip();\n" +
"    if (g) return g.end(chunk, enc, cb);\n" +
"    return origEnd(chunk, enc, cb);\n" +
"  };\n" +
"  next();\n" +
"});\n" +
"\n" +
"app.use(express.json());", 'gzip compression');

// ---- 2. Strict rate limits on auth endpoints ----
rep(/app\.use\(rateLimit\(500, 60000\)\);/,
"app.use(rateLimit(500, 60000));\n" +
"// Strict per-IP limits on authentication endpoints (brute-force protection)\n" +
"app.use('/api/auth/login', rateLimit(15, 60000));\n" +
"app.use('/api/auth/register', rateLimit(8, 60000));\n" +
"app.use('/api/auth/forgot-password', rateLimit(5, 60000));\n" +
"app.use('/api/auth/reset-password', rateLimit(10, 60000));\n" +
"app.use('/api/auth/guest', rateLimit(6, 60000));", 'auth rate limits');

// ---- 3. Extra security headers ----
rep(/  res\.setHeader\('X-XSS-Protection', '1; mode=block'\);\s*\r?\n\s*next\(\);/,
"  res.setHeader('X-XSS-Protection', '1; mode=block');\n" +
"  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');\n" +
"  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');\n" +
"  if (req.secure || (req.headers['x-forwarded-proto'] === 'https')) {\n" +
"    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');\n" +
"  }\n" +
"  next();", 'security headers');

fs.writeFileSync(p, s);
console.log('PART1 ok=' + ok + ' fail=' + fail);
