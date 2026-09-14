begin;
alter table public.client_board drop constraint if exists client_board_status_check;
alter table public.client_board add constraint client_board_status_check check (status in ('open','in_progress','review','done','approved','declined'));
commit;
