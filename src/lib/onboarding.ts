import { supabaseAdmin } from "@/lib/supabase/admin";
import { KARTE_SECTIONS } from "@/lib/constants";

export type ProvisionInput = {
  userId: string;
  email: string;
  displayName?: string | null;
  orgName?: string | null;
  industry?: string | null;
  website?: string | null;
  subjectName?: string | null;
  subjectType?: string | null;
  avatarUrl?: string | null;
};

export type ProvisionResult = {
  orgId: string;
  subjectId?: string | null;
  existed?: boolean;
};

/**
 * 登録直後に、組織・広報対象・初期レコード一式を用意する。
 * 呼び出したユーザーが owner になる。冪等 — 既に所属があればそれを返す。
 */
export async function provisionOrganization(input: ProvisionInput): Promise<ProvisionResult> {
  const sb = supabaseAdmin();

  const { data: existing } = await sb
    .from("memberships")
    .select("org_id")
    .eq("user_id", input.userId)
    .maybeSingle();

  if (existing) {
    // プロフィールだけは最新の入力で更新しておく
    await sb
      .from("profiles")
      .upsert(
        {
          id: input.userId,
          email: input.email,
          display_name: input.displayName ?? input.email,
          ...(input.avatarUrl ? { avatar_url: input.avatarUrl } : {}),
        },
        { onConflict: "id" },
      );
    return { orgId: existing.org_id, existed: true };
  }

  const { data: org, error } = await sb
    .from("organizations")
    .insert({
      name: input.orgName || "新しい会社",
      industry: input.industry ?? null,
      website: input.website ?? null,
    })
    .select("id")
    .single();

  if (error || !org) throw new Error(error?.message ?? "組織の作成に失敗しました");

  await sb.from("memberships").insert({ org_id: org.id, user_id: input.userId, role: "owner" });

  // 会社名は organizations 側が正なので、profiles には書かない。
  // (0004 未適用の環境でも登録が通るようにするため)
  await sb.from("profiles").upsert(
    {
      id: input.userId,
      email: input.email,
      display_name: input.displayName ?? input.email,
      ...(input.avatarUrl ? { avatar_url: input.avatarUrl } : {}),
    },
    { onConflict: "id" },
  );

  await sb.from("subscriptions").insert({ org_id: org.id, status: "none" });

  const { data: subject } = await sb
    .from("subjects")
    .insert({
      org_id: org.id,
      name: input.subjectName || input.orgName || "自社",
      type: input.subjectType || "company",
      website: input.website ?? null,
      is_primary: true,
    })
    .select("id")
    .single();

  if (subject) await scaffoldSubject(org.id, subject.id);

  return { orgId: org.id, subjectId: subject?.id };
}

/** 広報対象を作った直後の初期レコード一式。 */
export async function scaffoldSubject(orgId: string, subjectId: string) {
  const sb = supabaseAdmin();

  await sb.from("karte_sections").upsert(
    KARTE_SECTIONS.map((s) => ({
      org_id: orgId,
      subject_id: subjectId,
      key: s.key,
      label: s.label,
      content: null,
      confidence: 0,
      source: "user",
    })),
    { onConflict: "subject_id,key" },
  );

  await sb.from("brand_voice").upsert(
    { org_id: orgId, subject_id: subjectId, emoji_policy: "minimal" },
    { onConflict: "subject_id" },
  );

  await sb.from("dialogue_settings").upsert(
    { org_id: orgId, subject_id: subjectId, frequency: "daily", send_hour: 9 },
    { onConflict: "subject_id" },
  );

  for (const type of ["x", "instagram", "facebook", "gbp", "wordpress"]) {
    await sb
      .from("channels")
      .upsert(
        { org_id: orgId, subject_id: subjectId, type, frequency_mode: "ai_auto" },
        { onConflict: "subject_id,type" },
      );
  }

  await sb.from("approval_rules").insert({
    org_id: orgId,
    subject_id: subjectId,
    min_risk: "none",
    required_roles: ["approver"],
    auto_approve: false,
  });
}
