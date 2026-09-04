const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'casino_secret_key_123';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

/**
 * Generates a signed JWT token.
 * @param {Object} payload - User metadata (e.g., { id, role }).
 * @returns {string} Signed JWT string.
 */
function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
    algorithm: 'HS256',
  });
}

/**
 * Express middleware to verify JWT Authorization header.
 */
function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed authorization token.' });
  }

  const token = authHeader.split(' ')[1];

  jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }, (err, user) => {
    if (err) {
      const message = err.name === 'TokenExpiredError' 
        ? 'Session token expired.' 
        : 'Invalid session token.';
      return res.status(403).json({ error: message });
    }
    req.user = user;
    next();
  });
}

module.exports = { generateToken, verifyToken };