'use strict';

// ===== Supabase Configuration =====
// Fill in your project URL and anon key from:
//   Supabase Dashboard → Project Settings → API
const SUPABASE_URL      = 'https://epmwpjsquznsmeqzdwia.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVwbXdwanNxdXpuc21lcXpkd2lhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2MTgxOTYsImV4cCI6MjA5MTE5NDE5Nn0.Ql3OaAOS3t2zUR0Bg0GEpVfokHDBIk7ULKcGQl49jWU';

// supabaseClient is null until real credentials are provided
let supabaseClient = null;
try {
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch {
  // Placeholder credentials — all Supabase features are disabled until configured
}
