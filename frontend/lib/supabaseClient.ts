import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

// Used only for: sending magic-link/OTP emails, verifying the code, and
// holding the resulting session so we can attach it as a Bearer token on
// requests that need proof of who's asking (currently: transfer only).
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
