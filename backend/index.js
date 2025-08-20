// chatbot/backend/index.js
require('dotenv').config();

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const { protect } = require('./middleware/auth');
const chatRoutes = require('./routes/chatRoutes');
const supabaseAdmin = require('./supabaseAdmin'); // We need the admin client for batch writing

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const PORT = process.env.PORT || 3001;
const supabaseJwtSecret = process.env.SUPABASE_JWT_SECRET;

// --- NEW: Message Queue and Room Management ---
const messageQueue = [];
const chatRooms = new Map();

app.locals.messageQueue = messageQueue; // Make queue accessible in routes
app.locals.chatRooms = chatRooms; // Make rooms accessible in routes

app.use(express.json());

// --- Routes ---
app.get('/api/health', (req, res) => res.status(200).json({ status: 'ok' }));
app.use('/api/chats', protect, chatRoutes);

// --- WebSocket Logic ---
wss.on('connection', (ws, req) => {
  const token = new URL(req.url, `http://${req.headers.host}`).searchParams.get('token');
  if (!token) return ws.close(1008, 'No token provided');

  try {
    const decoded = jwt.verify(token, supabaseJwtSecret);
    ws.userId = decoded.sub;
    console.log(`Client connected and authenticated: ${ws.userId}`);
  } catch (error) {
    return ws.close(1008, 'Invalid token');
  }

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'join') {
        const chatId = data.chat_id;
        if (!chatRooms.has(chatId)) {
          chatRooms.set(chatId, new Set());
        }
        // Remove from old rooms before joining a new one
        chatRooms.forEach(clients => clients.delete(ws));
        chatRooms.get(chatId).add(ws);
        console.log(`User ${ws.userId} joined chat: ${chatId}`);
      }
    } catch (error) {
      console.error('Failed to process ws message:', error);
    }
  });

  ws.on('close', () => {
    console.log(`Client disconnected: ${ws.userId}`);
    chatRooms.forEach(clients => clients.delete(ws));
  });
});

// --- NEW: Batch Writing Logic ---
const BATCH_INTERVAL = 1000; // 1 second
setInterval(async () => {
  if (messageQueue.length === 0) {
    return; // Do nothing if the queue is empty
  }

  // Take all messages currently in the queue for this batch
  const messagesToInsert = messageQueue.splice(0, messageQueue.length);
  console.log(`Processing batch of ${messagesToInsert.length} messages.`);

  try {
    const { error } = await supabaseAdmin
      .from('messages')
      .insert(messagesToInsert);

    if (error) {
      throw error;
    }
    console.log('Successfully inserted batch into database.');
  } catch (error) {
    console.error('Failed to insert message batch:', error.message);
    // IMPORTANT: Add failed messages back to the front of the queue to retry
    messageQueue.unshift(...messagesToInsert);
  }
}, BATCH_INTERVAL);

// --- Start Server ---
server.listen(PORT, () => {
  console.log(`Server is running and listening on http://localhost:${PORT}`);
});