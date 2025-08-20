// chatbot/backend/supabaseClient.js

// --- ADD THIS LINE AT THE VERY TOP ---
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

// Get Supabase credentials from environment variables
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

// Create and export the Supabase client
const supabase = createClient(supabaseUrl, supabaseAnonKey);

module.exports = supabase;