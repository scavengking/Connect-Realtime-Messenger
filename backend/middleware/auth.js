// chatbot/backend/middleware/auth.js

const supabase = require('../supabaseClient');

const protect = async (req, res, next) => {
  // 1. Check for the Authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  // 2. Extract the token from the header
  const token = authHeader.split(' ')[1];

  try {
    // 3. Verify the token with Supabase
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      throw new Error(error?.message || 'Invalid token');
    }

    // 4. If the token is valid, attach the user to the request object
    req.user = data.user;

    // 5. Pass control to the next middleware/route handler
    next();
  } catch (error) {
    console.error('Authentication error:', error.message);
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

module.exports = { protect };