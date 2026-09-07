-- ============================================================================
-- AI広報 — メール確認を挟まない登録に対応
-- ============================================================================
-- 登録は service role の createUser(email_confirm: true) で行うため、
-- 確認メールは送信されず、登録直後からログインできる。
--
-- これにより「認証前に一時領域へアバターを置く」必要がなくなったので、
-- 未認証(anon)がストレージへ書き込める経路を閉じる。
drop policy if exists avatars_signup_write on storage.objects;

-- 既存の未確認ユーザーを確認済みにして、ログインできるようにする。
-- (この変更より前に登録し、確認メールのリンクを踏んでいないユーザーの救済)
-- 注: auth.users.confirmed_at は生成列のため更新しない
--     (email_confirmed_at から自動的に導出される)
update auth.users
set email_confirmed_at = now()
where email_confirmed_at is null;
