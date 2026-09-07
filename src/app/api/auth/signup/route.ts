import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { provisionOrganization } from "@/lib/onboarding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 新規登録。
 *
 * クライアントの `auth.signUp()` を使うと、プロジェクト設定によっては
 * 確認メール(認証リンク)が送信され、確認するまでログインできない。
 * ここでは service role で `email_confirm: true` のユーザーを直接作るため、
 * 確認メールは一切送信されず、登録後すぐにログインできる。
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;

    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const displayName = String(body.displayName ?? "").trim();
    const orgName = String(body.orgName ?? "").trim();

    // ---------------------------------------------------------- 入力検証 --
    if (!email || !password || !displayName || !orgName) {
      return fail("必須項目が入力されていません");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return fail("メールアドレスの形式が正しくありません");
    }
    if (password.length < 8) {
      return fail("パスワードは8文字以上にしてください");
    }
    if (password !== String(body.passwordConfirm ?? password)) {
      return fail("確認用パスワードが一致しません");
    }

    const sb = supabaseAdmin();

    // ------------------------------------------------ ユーザーの作成 -----
    // email_confirm: true → メール確認済みとして作成するため、
    // Supabase は確認メールを送信しない。
    const { data: created, error } = await sb.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    });

    if (error || !created?.user) {
      const message = error?.message ?? "";
      if (/already|registered|exists|duplicate/i.test(message)) {
        return fail("このメールアドレスは既に登録されています", 409);
      }
      if (/password/i.test(message)) {
        return fail("パスワードが要件を満たしていません", 400);
      }
      console.error("[signup] createUser failed:", message);
      return fail("登録に失敗しました。時間をおいて再度お試しください。", 500);
    }

    const userId = created.user.id;

    // ------------------------------------------ 組織と広報対象の初期化 ---
    try {
      const result = await provisionOrganization({
        userId,
        email,
        displayName,
        orgName,
        website: (body.website as string) ?? null,
        subjectName: (body.subjectName as string) ?? null,
        subjectType: (body.subjectType as string) ?? "company",
      });

      return NextResponse.json({ ok: true, data: { userId, ...result } });
    } catch (err) {
      // 組織作成に失敗したらユーザーを残さない (再登録できるようにする)
      await sb.auth.admin.deleteUser(userId).catch(() => undefined);
      console.error("[signup] provision failed:", err);
      return fail(
        err instanceof Error && /relation|column|does not exist/i.test(err.message)
          ? "データベースの初期設定が未完了です。supabase/schema.sql を適用してください。"
          : "初期設定に失敗しました。時間をおいて再度お試しください。",
        500,
      );
    }
  } catch (err) {
    console.error("[signup]", err);
    return fail("登録に失敗しました", 500);
  }
}

function fail(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}
