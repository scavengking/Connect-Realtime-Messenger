// src/App.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabaseClient';

// --- Type Definitions ---
type Chat = { id: string; name: string | null; is_group: boolean };
type Msg = { id?: string; chat_id: string; sender_id: string; content: string; inserted_at?: string };

// --- Main App Component (Authentication Gate) ---
export default function App() {
  const [session, setSession] = useState<any>(null);

  useEffect(() => {
    // Fetch the current session on initial load
    supabase.auth.getSession().then(({ data }) => setSession(data.session));

    // Listen for changes in authentication state (sign in/out)
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));

    // Cleanup the subscription when the component unmounts
    return () => sub.subscription.unsubscribe();
  }, []);

  // If there is no active session, show the login form
  if (!session) {
    return <AuthForm />;
  }

  // If a session exists, show the main chat interface
  return <ChatInterface session={session} />;
}

// --- Chat Interface Component ---
function ChatInterface({ session }: { session: any }) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [currentChat, setCurrentChat] = useState<Chat | null>(null);
  const [history, setHistory] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Automatically scroll to the latest message whenever the history changes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  // Fetch the user's available chats when the component mounts
  useEffect(() => {
    const fetchChats = async () => {
      try {
        const response = await fetch('/api/chats', {
          headers: { 'Authorization': `Bearer ${session.access_token}` }
        });
        if (!response.ok) throw new Error('Failed to fetch chats');
        const chatData = await response.json();
        setChats(chatData);
      } catch (error) {
        console.error('Error fetching chats:', error);
      }
    };
    fetchChats();
  }, [session]);

  // Memoize the WebSocket URL to prevent re-computation on every render
  const wsUrl = useMemo(() => {
    const token = session.access_token;
    const base = import.meta.env.VITE_SERVER_WS_URL!; // e.g., 'ws://localhost:3001'
    return `${base}?token=${encodeURIComponent(token)}`;
  }, [session]);

  // Establish and manage the WebSocket connection
  useEffect(() => {
    if (!wsUrl) return;

    const ws = new WebSocket(wsUrl);

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      
      // *** BUG FIX IMPLEMENTED HERE ***
      // Only add the incoming message to the history if it's from another user.
      // The sender's own messages are added optimistically in the `send` function.
      if (msg.type === 'new_message' && msg.sender_id !== session.user.id) {
        setHistory((h) => [...h, msg]);
      }
    };

    wsRef.current = ws;

    // Clean up the WebSocket connection when the component unmounts
    return () => ws.close();
  }, [wsUrl, session.user.id]);

  // Function to switch to a selected chat room
  const joinChat = async (chat: Chat) => {
    setCurrentChat(chat);
    setHistory([]); // Clear history from the previous chat

    try {
      const response = await fetch(`/api/chats/${chat.id}/messages`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` }
      });
      if (!response.ok) throw new Error('Failed to fetch history');
      const data = await response.json();
      setHistory(data);
    } catch (error) {
      console.error("Error fetching chat history:", error);
    }

    // Inform the server via WebSocket that we are joining this chat room
    wsRef.current?.send(JSON.stringify({ type: 'join', chat_id: chat.id }));
  };

  // Function to send a new message
  const send = async () => {
    if (!currentChat || !input.trim()) return;

    const content = input.trim();
    setInput(''); // Clear input field immediately

    // Optimistically update the UI with the new message
    setHistory(h => [...h, {
      chat_id: currentChat.id,
      sender_id: session.user.id,
      content: content,
      inserted_at: new Date().toISOString() // Temporary timestamp for the key
    }]);

    // Send the message to the backend API to be persisted and broadcast
    await fetch(`/api/chats/${currentChat.id}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ content: content })
    });
  };

  // Handle user sign-out
  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <div style={styles.container}>
      {/* Sidebar for chat list and sign-out */}
      <aside style={styles.sidebar}>
        <div>
          <h3 style={styles.sidebarHeader}>Chats</h3>
          <ul style={styles.chatList}>
            {chats.map(c => (
              <li key={c.id} style={styles.chatListItem}>
                <button
                  onClick={() => joinChat(c)}
                  style={currentChat?.id === c.id ? styles.chatButtonActive : styles.chatButton}
                >
                  {c.name || (c.is_group ? 'Group' : 'DM')}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <button onClick={handleSignOut} style={styles.signOutButton}>Sign Out</button>
      </aside>

      {/* Main content area for chat messages */}
      <main style={styles.mainContent}>
        <h3 style={styles.chatHeader}>
          {currentChat ? (currentChat.name || `Chat with ${currentChat.id.slice(0, 6)}...`) : 'Select a chat'}
        </h3>
        <div style={styles.messageContainer}>
          {history.map((m, i) => (
            <div key={i} style={m.sender_id === session.user.id ? styles.myMessage : styles.theirMessage}>
              <div style={{ ...styles.messageBubble, backgroundColor: m.sender_id === session.user.id ? '#007bff' : '#3a3f48' }}>
                <strong>{m.sender_id.slice(0, 6)}:</strong> {m.content}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
        
        {/* Input form for sending messages */}
        {currentChat && (
          <form style={styles.inputArea} onSubmit={(e) => { e.preventDefault(); send(); }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Type a message..."
              style={styles.inputField}
            />
            <button type="submit" style={styles.sendButton}>Send</button>
          </form>
        )}
      </main>
    </div>
  );
}

// --- Authentication Form Component ---
function AuthForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const signIn = async () => { await supabase.auth.signInWithPassword({ email, password }); };
  const signUp = async () => { await supabase.auth.signUp({ email, password }); };

  return (
    <div style={authStyles.container}>
      <div style={authStyles.form}>
        <h2 style={{ color: '#fff', textAlign: 'center' }}>Login / Signup</h2>
        <input
          placeholder="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          style={authStyles.input}
        />
        <input
          type="password"
          placeholder="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          style={authStyles.input}
        />
        <button onClick={signIn} style={authStyles.button}>Sign in</button>
        <button onClick={signUp} style={authStyles.button}>Sign up</button>
      </div>
    </div>
  );
}

// --- STYLES ---

const styles = {
  container: { display: 'flex', height: '100vh', backgroundColor: '#282c34', color: 'white' },
  sidebar: { width: '280px', backgroundColor: '#21252b', padding: '16px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', borderRight: '1px solid #444' },
  sidebarHeader: { borderBottom: '1px solid #444', paddingBottom: '10px' },
  chatList: { listStyle: 'none', padding: 0 },
  chatListItem: { marginBottom: '8px' },
  chatButton: { width: '100%', padding: '10px', backgroundColor: '#3a3f48', border: 'none', color: 'white', borderRadius: '5px', cursor: 'pointer', textAlign: 'left', transition: 'background-color 0.2s' },
  chatButtonActive: { width: '100%', padding: '10px', backgroundColor: '#007bff', border: 'none', color: 'white', borderRadius: '5px', cursor: 'pointer', textAlign: 'left' },
  signOutButton: { padding: '10px', backgroundColor: '#dc3545', border: 'none', color: 'white', borderRadius: '5px', cursor: 'pointer', transition: 'background-color 0.2s' },
  mainContent: { flex: 1, display: 'flex', flexDirection: 'column', padding: '16px' },
  chatHeader: { borderBottom: '1px solid #444', paddingBottom: '10px', margin: 0, height: '40px' },
  messageContainer: { flex: 1, overflowY: 'auto', padding: '10px 5px' },
  myMessage: { display: 'flex', justifyContent: 'flex-end', marginBottom: '10px' },
  theirMessage: { display: 'flex', justifyContent: 'flex-start', marginBottom: '10px' },
  messageBubble: { maxWidth: '60%', padding: '10px 15px', borderRadius: '20px', color: 'white', wordBreak: 'break-word' },
  inputArea: { display: 'flex', gap: '10px', paddingTop: '10px', borderTop: '1px solid #444' },
  inputField: { flex: 1, padding: '10px 15px', borderRadius: '20px', border: 'none', backgroundColor: '#3a3f48', color: 'white' },
  sendButton: { padding: '10px 20px', borderRadius: '20px', border: 'none', backgroundColor: '#007bff', color: 'white', cursor: 'pointer', transition: 'background-color 0.2s' },
} as const;

const authStyles = {
  container: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: '#282c34' },
  form: { display: 'grid', gap: '16px', width: '320px', padding: '24px', backgroundColor: '#21252b', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.3)' },
  input: { padding: '12px', borderRadius: '5px', border: '1px solid #444', backgroundColor: '#3a3f48', color: 'white' },
  button: { padding: '12px', borderRadius: '5px', border: 'none', backgroundColor: '#007bff', color: 'white', cursor: 'pointer', transition: 'background-color 0.2s' },
} as const;