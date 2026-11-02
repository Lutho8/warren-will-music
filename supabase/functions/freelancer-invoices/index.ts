import { createClient } from 'jsr:@supabase/supabase-js@2.57.4';
import { createInvoiceHandler } from './handler.ts';

const sb=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
// JWT verification is performed inside the handler. It also supports the
// existing management passphrase, never the artist's shared passphrase.
Deno.serve(createInvoiceHandler(sb,()=>Deno.env.get('ADMIN_DASH_KEY')||''));
