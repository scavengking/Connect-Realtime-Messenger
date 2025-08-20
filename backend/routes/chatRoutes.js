// chatbot/backend/routes/chatRoutes.js
const supabaseAdmin = require('../supabaseAdmin');
const express = require('express');
const supabase = require('../supabaseClient');
const router = express.Router();

// --- 1. List Chats for the authenticated user ---
router.get('/', async (req, res) => {
  const userId = req.user.id; // From the 'protect' middleware

  try {
    const { data, error } = await supabaseAdmin
      .from('chat_members')
      .select(`
        chat_id,
        chats (
          id,
          name,
          is_group
        )
      `)
      .eq('user_id', userId);

    if (error) throw error;

    const formattedChats = data.map(item => ({
      id: item.chats.id,
      name: item.chats.name,
      is_group: item.chats.is_group
    }));

    res.status(200).json(formattedChats);
  } catch (error) {
    console.error('Error fetching chats:', error.message);
    res.status(500).json({ error: 'Failed to fetch chats' });
  }
});


// --- 2. Create a new Chat ---
router.post('/', async (req, res) => {
    const creatorId = req.user.id;
    const { other_user_id, name, member_ids } = req.body;
    const is_group = !!member_ids || !other_user_id;

    try {
        const { data: chatData, error: chatError } = await supabaseAdmin
            .from('chats')
            .insert({ name: name, is_group: is_group })
            .select()
            .single();

        if (chatError) throw chatError;

        const chatId = chatData.id;

        let allMemberIds;
        if (other_user_id) {
            allMemberIds = [creatorId, other_user_id];
        } else if (member_ids) {
            allMemberIds = [...new Set([creatorId, ...member_ids])];
        } else {
            return res.status(400).json({ error: 'Missing member information' });
        }

        const membersToInsert = allMemberIds.map(id => ({
            chat_id: chatId,
            user_id: id
        }));

        const { error: memberError } = await supabaseAdmin
            .from('chat_members')
            .insert(membersToInsert);

        if (memberError) throw memberError;

        res.status(201).json({ chat_id: chatId });
    } catch (error) {
        console.error('Error creating chat:', error.message);
        res.status(500).json({ error: 'Failed to create chat' });
    }
});

// --- 3. Get Message History for a chat ---
router.get('/:chat_id/messages', async (req, res) => {
  const { chat_id } = req.params;
  const limit = req.query.limit || 100;

  try {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('chat_id', chat_id)
      .order('inserted_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    res.status(200).json(data.reverse());
  } catch (error) {
    console.error('Error fetching message history:', error.message);
    res.status(500).json({ error: 'Failed to fetch message history' });
  }
});

// --- 4. Send a new Message ---
router.post('/:chat_id/messages', (req, res) => {
  const { chat_id } = req.params;
  const { content } = req.body;
  const sender_id = req.user.id;

  if (!content) {
    return res.status(400).json({ error: 'Content is required' });
  }

  const newMessage = {
    chat_id,
    sender_id,
    content,
  };

  // 1. Enqueue the message to the server's buffer
  const messageQueue = req.app.locals.messageQueue;
  messageQueue.push(newMessage);

  // 2. Broadcast the message immediately over WebSocket
  const chatRooms = req.app.locals.chatRooms;
  const room = chatRooms.get(chat_id);
  if (room) {
    const broadcastMessage = JSON.stringify({
      type: 'new_message',
      ...newMessage,
      inserted_at: new Date().toISOString()
    });
    room.forEach(client => {
      // Broadcast to everyone in the room INCLUDING the sender
      // The sender's optimistic UI will be replaced by the "real" message
      if (client.readyState === client.OPEN) {
        client.send(broadcastMessage);
      }
    });
  }

  res.status(202).json({ message: 'Message received.' });
});


module.exports = router;