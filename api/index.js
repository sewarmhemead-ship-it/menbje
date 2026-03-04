/**
 * Vercel serverless entry: forward all requests to the Express app.
 * Rewrites in vercel.json send every path here; Express handles /, /dashboard/, /api/, etc.
 */
import app from '../server/index.js';

export default (req, res) => {
  return app(req, res);
};
