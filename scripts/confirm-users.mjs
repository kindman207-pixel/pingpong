#!/usr/bin/env node
/**
 * 未確認のままログインできなくなっているユーザーを、すべて確認済みにする。
 *
 *   npm run db:confirm-users
 *
 * この変更より前に登録し、確認メールのリンクを踏んでいないユーザーの救済用。
 * 以降の新規登録はサーバー側で確認済みとして作成されるため、実行は一度だけで足りる。
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const file of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(join(root, file), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // 任意
  }
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

async function main() {
  const unconfirmed = [];

  for (let page = 1; page <= 50; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`ユーザー一覧の取得に失敗しました: ${error.message}`);
    if (!data.users.length) break;

    for (const u of data.users) {
      if (!u.email_confirmed_at) unconfirmed.push(u);
    }
    if (data.users.length < 200) break;
  }

  if (!unconfirmed.length) {
    console.log("\n✓ 未確認のユーザーはいません。全員そのままログインできます。\n");
    return;
  }

  console.log(`→ 未確認のユーザー: ${unconfirmed.length}名`);

  let ok = 0;
  for (const u of unconfirmed) {
    const { error } = await sb.auth.admin.updateUserById(u.id, { email_confirm: true });
    if (error) {
      console.log(`  ✗ ${u.email}: ${error.message}`);
    } else {
      ok++;
      console.log(`  ✓ ${u.email}`);
    }
  }

  console.log(`\n✓ ${ok}/${unconfirmed.length}名を確認済みにしました。ログインできます。\n`);
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}`);
  process.exitCode = 1;
});
