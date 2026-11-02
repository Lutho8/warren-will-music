// Resolve permissions from a verified user and the server-owned role directory.
export async function crmIdentity(req: Request, sb: any) {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer /i, '');
  if (!bearer) return null;
  const { data, error } = await sb.auth.getUser(bearer);
  const user = data?.user;
  if (error || !user?.email_confirmed_at || user.app_metadata?.crm_enabled !== true) return null;
  const { data: assignment, error: roleError } = await sb.from('crm_user_roles')
    .select('role,active').eq('user_id', user.id).eq('active', true).maybeSingle();
  if (roleError || !assignment) return null;
  const roles: Record<string,string> = {artist:'client',management:'team',social_media:'social'};
  const role = roles[assignment.role];
  if (!role) return null;
  return {role, actor:user.id, owner:assignment.role === 'artist'};
}

// Legacy data services are only callable by the authenticated workspace proxy.
export function internalCrmRequest(req: Request): boolean {
  const expected = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  return !!expected && req.headers.get('x-crm-internal') === expected;
}
