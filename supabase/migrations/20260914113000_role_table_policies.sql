begin;
create policy "service role manages crm roles" on public.crm_user_roles for all to service_role using (true) with check (true);
create policy "service role manages pitch campaigns" on public.artist_pitch_campaigns for all to service_role using (true) with check (true);
create policy "service role manages pitch targets" on public.artist_pitch_targets for all to service_role using (true) with check (true);
create policy "service role manages work logs" on public.board_work_logs for all to service_role using (true) with check (true);
commit;
