'use strict';
const express = require('express');
const app = express();
const http = require('http');
// Gzip compression - client.js/styles.css are large; cuts payload ~70-80%.
app.use((req, res, next) => {
  const accept = req.headers['accept-encoding'] || '';
  if (!accept.includes('gzip')) return next();
  const origWrite = res.write.bind(res);
  const origEnd = res.end.bind(res);
  let stream = null;
  let done = false;
  const cleanup = () => { done = true; };
  res.on('close', () => { if (stream && !done) { cleanup(); try { stream.destroy(); } catch (e) {} } });
  const tryGzip = () => {
    if (stream || done || res.headersSent) return stream;
    const ct = String(res.getHeader('Content-Type') || '');
    if (res.getHeader('Content-Encoding')) return null;
    if (!/text\/|application\/(json|javascript|xml)|image\/svg/.test(ct)) return null;
    res.setHeader('Content-Encoding', 'gzip');
    res.removeHeader('Content-Length');
    stream = require('zlib').createGzip();
    stream.on('error', () => { cleanup(); try { origEnd(); } catch (e) {} });
    // NOTE: do NOT stream.pipe(res) here â€” pipe would route the compressed
    // chunks through the overridden res.write below, which drops them after
    // done=true (the client then hangs waiting for a body that never comes).
    // Forward gzip output through the ORIGINAL write/end instead.
    stream.on('data', (c) => { try { origWrite(c); } catch (e) {} });
    stream.on('end', () => { cleanup(); try { origEnd(); } catch (e) {} });
    return stream;
  };
  res.write = (chunk, enc, cb) => {
    if (done) return false;
    const g = tryGzip();
    if (g) return g.write(chunk, enc, cb);
    return origWrite(chunk, enc, cb);
  };
  res.end = (chunk, enc, cb) => {
    if (done) return;
    const g = tryGzip();
    if (g) return g.end(chunk, enc, cb);
    return origEnd(chunk, enc, cb);
  };
  next();
});

app.get('/api/health', (req, res) => res.json({ ok: true }));
http.createServer(app).listen(3099, () => console.log('up'));
